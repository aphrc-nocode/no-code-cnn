# asr_utils/utils.py

import math
import random
import re
import unicodedata
import functools
from typing import Any, Dict, List, Optional, Tuple, Union

import datasets
import numpy as np
import pandas as pd
import tqdm
from datasets import Dataset, DatasetDict


# --- Helper Function for Formatting Duration ---
def format_duration(total_seconds: Optional[float]) -> str:
    """Formats a duration in seconds into a human-readable string (Hh Mm Ss.s)."""
    if total_seconds is None or not isinstance(total_seconds, (int, float)) or total_seconds < 0:
        return "N/A"
    total_seconds = float(total_seconds)
    if math.isclose(total_seconds, 0):
        return "0.0s"

    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = total_seconds % 60

    parts = []
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if seconds > 1e-6 or not parts:
        parts.append(f"{seconds:.1f}s")
    return " ".join(parts) if parts else "0.0s"


def random_split(dataset: Dataset, train_ratio: float, dev_ratio: float, random_seed: Optional[int] = None):
    """Randomly splits a dataset into train, dev, and test sets."""
    # --- MODIFIED: Removed `dataset = dataset["train"]` to operate on the provided dataset ---
    if not isinstance(dataset, Dataset):
        raise TypeError(f"Input must be a datasets.Dataset, but got {type(dataset)}")

    indices = list(range(len(dataset)))

    if random_seed is not None:
        random.seed(random_seed)

    random.shuffle(indices)

    num_items = len(indices)
    num_train = math.floor(num_items * train_ratio)
    num_dev = math.floor(num_items * dev_ratio)

    # Divide the shuffled items into sets
    train = dataset.select(indices[:num_train])
    dev = dataset.select(indices[num_train : num_train + num_dev])
    test = dataset.select(indices[num_train + num_dev :])

    return train, dev, test


# --- Main Splitting Function (Modified) ---
def split_hf_dataset(
    dataset: Dataset,
    speaker_id_col: str,
    train_ratio: float = 0.8,
    dev_ratio: float = 0.1,
    test_ratio: float = None,
    duration_col: Optional[str] = None,
    random_seed: int = None,
    verbose: bool = True,
    num_proc: int = 1,
) -> Tuple[Dataset, Dataset, Dataset]:
    """
    Splits a Hugging Face Dataset into train, development (dev), and test sets
    ensuring speaker disjointness.
    """
    # --- MODIFIED: Removed `dataset = dataset["train"]` to operate on the provided dataset ---
    if not isinstance(dataset, Dataset):
        raise TypeError(f"Input data must be a Hugging Face datasets.Dataset object. Got {type(dataset)} instead.")

    if random_seed is not None:
        random.seed(random_seed)
    if test_ratio is None:
        test_ratio = 1.0 - train_ratio - dev_ratio
    if not math.isclose(train_ratio + dev_ratio + test_ratio, 1.0):
        raise ValueError(f"Ratios must sum to ~1.0 (sum: {train_ratio + dev_ratio + test_ratio})")
    if train_ratio < 0 or dev_ratio < 0 or test_ratio < 0:
        raise ValueError("Ratios cannot be negative.")
    if speaker_id_col not in dataset.column_names:
        raise ValueError(f"Speaker ID column '{speaker_id_col}' not found.")

    unique_speakers = dataset.unique(speaker_id_col)
    if not unique_speakers:
        raise ValueError(f"No unique speakers found in column '{speaker_id_col}'.")

    num_speakers = len(unique_speakers)
    if verbose:
        print(f"Found {num_speakers} unique speakers in column '{speaker_id_col}'.")
    if num_speakers < 3 and verbose:
        print(f"Warning: Very few speakers ({num_speakers}). Split ratios may be skewed.")

    random.shuffle(unique_speakers)

    n_train = math.floor(num_speakers * train_ratio)
    n_dev = math.floor(num_speakers * dev_ratio)

    if dev_ratio > 0 and n_dev == 0 and num_speakers > n_train:
        n_dev = 1

    n_test = num_speakers - n_train - n_dev

    if test_ratio > 0 and n_test == 0 and num_speakers > (n_train + n_dev):
        n_test = 1
        if n_train + n_dev + n_test > num_speakers:
            n_train = num_speakers - n_dev - n_test

    if verbose:
        p_train = n_train / num_speakers if num_speakers > 0 else 0.0
        p_dev = n_dev / num_speakers if num_speakers > 0 else 0.0
        p_test = n_test / num_speakers if num_speakers > 0 else 0.0
        print(f"Target speaker split: Train={n_train} ({p_train:.1%}), Dev={n_dev} ({p_dev:.1%}), Test={n_test} ({p_test:.1%})")
        if n_train <= 0 and train_ratio > 0: print(f"Warning: 0 speakers allocated for train set despite train_ratio={train_ratio}.")
        if n_dev <= 0 and dev_ratio > 0: print(f"Warning: 0 speakers allocated for dev set despite dev_ratio={dev_ratio}.")
        if n_test <= 0 and test_ratio > 0: print(f"Warning: 0 speakers allocated for test set despite test_ratio={test_ratio}.")

    train_speaker_set = set(unique_speakers[:n_train])
    dev_speaker_set = set(unique_speakers[n_train : n_train + n_dev])
    test_speaker_set = set(unique_speakers[n_train + n_dev :])

    assert train_speaker_set.isdisjoint(dev_speaker_set), "Train/Dev speaker overlap!"
    assert train_speaker_set.isdisjoint(test_speaker_set), "Train/Test speaker overlap!"
    assert dev_speaker_set.isdisjoint(test_speaker_set), "Dev/Test speaker overlap!"
    assert (len(train_speaker_set) + len(dev_speaker_set) + len(test_speaker_set)) == num_speakers, "Speaker set sum mismatch!"

    train_data = dataset.filter(lambda ex: ex[speaker_id_col] in train_speaker_set, num_proc=num_proc)
    dev_data = dataset.filter(lambda ex: ex[speaker_id_col] in dev_speaker_set, num_proc=num_proc)
    test_data = dataset.filter(lambda ex: ex[speaker_id_col] in test_speaker_set, num_proc=num_proc)

    if verbose:
        total_items = len(dataset)
        print("\nActual split (data items):")
        train_item_perc = len(train_data) / total_items if total_items > 0 else 0.0
        dev_item_perc = len(dev_data) / total_items if total_items > 0 else 0.0
        test_item_perc = len(test_data) / total_items if total_items > 0 else 0.0
        print(f"  Train: {len(train_data):,} items ({train_item_perc:.1%})")
        print(f"  Dev:   {len(dev_data):,} items ({dev_item_perc:.1%})")
        print(f"  Test:  {len(test_data):,} items ({test_item_perc:.1%})")
        print("-" * 30)

        if duration_col and duration_col in dataset.column_names:
            print(f"Actual split (duration - based on '{duration_col}' column, assumes seconds):")
            try:
                total_duration = sum(d for d in dataset[duration_col] if d is not None)
                train_duration = sum(d for d in train_data[duration_col] if d is not None)
                dev_duration = sum(d for d in dev_data[duration_col] if d is not None)
                test_duration = sum(d for d in test_data[duration_col] if d is not None)
                train_dur_perc = train_duration / total_duration if total_duration > 1e-6 else 0.0
                dev_dur_perc = dev_duration / total_duration if total_duration > 1e-6 else 0.0
                test_dur_perc = test_duration / total_duration if total_duration > 1e-6 else 0.0
                print(f"  Total: {format_duration(total_duration)}")
                print(f"  Train: {format_duration(train_duration)} ({train_dur_perc:.1%})")
                print(f"  Dev:   {format_duration(dev_duration)} ({dev_dur_perc:.1%})")
                print(f"  Test:  {format_duration(test_duration)} ({test_dur_perc:.1%})")
            except Exception as e:
                print(f"  Error: Could not calculate duration split due to an unexpected error: {e}")
            print("-" * 30)
        elif duration_col:
            print(f"Duration column '{duration_col}' not found in dataset. Skipping duration split report.")

    return train_data, dev_data, test_data


def add_duration_column(
    dataset: Union[Dataset, DatasetDict],
    audio_column: str = "audio",
    duration_column: str = "duration",
    num_proc: Optional[int] = None,
) -> Union[Dataset, DatasetDict]:
    """Adds a duration column (in seconds) to a Hugging Face speech dataset."""

    def _calculate_duration_batch(batch):
        audio_data_list = batch[audio_column]
        durations = []
        for audio_data in audio_data_list:
            if (
                audio_data is not None and isinstance(audio_data, dict) and "array" in audio_data
                and "sampling_rate" in audio_data and isinstance(audio_data["array"], (np.ndarray, list))
                and isinstance(audio_data["sampling_rate"], int) and audio_data["sampling_rate"] > 0
            ):
                duration = len(audio_data["array"]) / audio_data["sampling_rate"]
                durations.append(duration)
            else:
                durations.append(None)
        return {duration_column: durations}

    if isinstance(dataset, DatasetDict):
        processed_splits = {}
        for split_name, ds_split in dataset.items():
            if duration_column in ds_split.column_names:
                processed_splits[split_name] = ds_split
                continue
            if len(ds_split) == 0:
                processed_splits[split_name] = ds_split
                continue
            processed_splits[split_name] = add_duration_column(ds_split, audio_column, duration_column, num_proc)
        return DatasetDict(processed_splits)

    elif isinstance(dataset, Dataset):
        if len(dataset) == 0:
            return dataset
        if audio_column not in dataset.column_names:
            raise ValueError(f"Audio column '{audio_column}' not found in dataset columns: {dataset.column_names}")

        dataset_with_duration = dataset.map(
            _calculate_duration_batch, batched=True, num_proc=num_proc, desc=f"Calculating {duration_column}"
        )
        new_features = dataset_with_duration.features.copy()
        new_features[duration_column] = datasets.Value("float32")
        dataset_with_duration = dataset_with_duration.cast(new_features)
        return dataset_with_duration
    else:
        raise TypeError("Input must be a Hugging Face Dataset or DatasetDict.")


def find_problematic_audio_files(
    dataset: Dataset,
    audio_column: str = "audio",
    identifier_column: Optional[str] = "path",
    stop_on_first_error: bool = False,
    verbose: bool = True,
) -> List[Dict[str, Any]]:
    """Identifies items causing errors during data loading/decoding."""
    problematic_items: List[Dict[str, Any]] = []
    if len(dataset) == 0:
        if verbose:
            print("Dataset is empty. Skipping audio file check.")
        return problematic_items

    num_examples = len(dataset)

    if verbose:
        print(f"Starting audio file check on {num_examples} examples...")
        iterator = tqdm.tqdm(range(num_examples), desc="Checking dataset items")
    else:
        iterator = range(num_examples)

    has_identifier_col = identifier_column and identifier_column in dataset.column_names

    for i in iterator:
        error_occurred = False
        error_info = {"index": i, "identifier": None, "error": None}

        try:
            _ = dataset[i]  # Accessing the item triggers decoding
        except (ValueError, TypeError, OSError, Exception) as e:
            error_occurred = True
            error_info["error"] = str(e)
            if verbose:
                print(f"\nCaught error ({type(e).__name__}) at index {i}: {e}")
        finally:
            if error_occurred:
                identifier = None
                if has_identifier_col:
                    try:
                        item_metadata = dataset.select([i], keep_in_memory=True).select_columns([identifier_column])[0]
                        identifier = item_metadata[identifier_column]
                        error_info["identifier"] = identifier
                        if verbose:
                            print(f"  Identifier ('{identifier_column}'): {identifier}")
                    except Exception as meta_e:
                        if verbose:
                            print(f"  Could not retrieve identifier for index {i}: {meta_e}")

                problematic_items.append(error_info)
                if stop_on_first_error:
                    if verbose:
                        print("Stopping check after first error.")
                    break
    if verbose:
        print("\n--- Audio File Check Complete ---")
        if problematic_items:
            print(f"Found {len(problematic_items)} items causing loading errors.")
        else:
            print("No data loading errors detected during check.")
    return problematic_items


def clean_transcript(text: str, punctuation_to_remove: str = r"[^\w\s']", lowercase: bool = True) -> str:
    """Basic transcript cleaning: NFKC normalization, lowercase, punctuation removal."""
    if not isinstance(text, str):
        text = ""
    text = unicodedata.normalize("NFKC", text)
    if lowercase:
        text = text.lower()
    text = re.sub(r"[\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f]", "'", text)
    text = re.sub(punctuation_to_remove, "", text)
    text = " ".join(text.split())
    return text

def process_prepared_speech_dataset(
    input_dataset: Union[Dataset, DatasetDict],
    text_column: str,
    normalized_text_column: str,
    duration_column: str,
    min_duration_s: float,
    max_duration_s: float,
    min_transcript_len: int,
    max_transcript_len: int,
    outlier_std_devs: float,
    apply_outlier_filtering: bool,
    num_proc: int,
) -> Union[Dataset, DatasetDict]:
    """Performs text normalization and filtering on a speech dataset."""

    if isinstance(input_dataset, Dataset):
        raw_datasets = DatasetDict({"train": input_dataset})  # Process as a dict
        was_single_dataset = True
    elif isinstance(input_dataset, DatasetDict):
        raw_datasets = input_dataset
        was_single_dataset = False
    else:
        raise TypeError("input_dataset must be a datasets.Dataset or datasets.DatasetDict")

    original_counts = {split: len(ds) for split, ds in raw_datasets.items()}
    print(f"Input counts for processing: {original_counts}")

    def normalize_and_get_length(example):
        normalized = clean_transcript(example[text_column])
        example[normalized_text_column] = normalized
        example["transcript_len"] = len(normalized)
        return example

    def calculate_duration_length_ratio(example):
        if example["transcript_len"] > 0 and duration_column in example and example[duration_column] is not None:
            example["duration_len_ratio"] = example[duration_column] / example["transcript_len"]
        else:
            example["duration_len_ratio"] = float("nan")
        return example

    processed_datasets = {}
    for split, ds in raw_datasets.items():
        print(f"\n--- Processing split: {split} ---")
        if not ds or len(ds) == 0:
            print(f"Warning: Split '{split}' is empty or None. Skipping processing for this split.")
            processed_datasets[split] = Dataset.from_dict({}) if ds is None else ds
            continue

        if duration_column not in ds.column_names:
            raise ValueError(f"Duration column '{duration_column}' not found in dataset split '{split}'.")
        if text_column not in ds.column_names:
            raise ValueError(f"Text column '{text_column}' not found in dataset split '{split}'.")

        print(f"Filtering by duration ({min_duration_s}s - {max_duration_s}s) using '{duration_column}'...")
        ds = ds.filter(
            lambda x: x[duration_column] is not None and min_duration_s <= x[duration_column] <= max_duration_s,
            num_proc=num_proc,
        )
        print(f"Count after duration filtering: {len(ds)}")
        if len(ds) == 0:
            processed_datasets[split] = ds
            continue

        print("Normalizing transcripts and getting length...")
        ds = ds.map(normalize_and_get_length, num_proc=num_proc)

        print(f"Filtering by transcript length ({min_transcript_len} - {max_transcript_len} chars)...")
        ds = ds.filter(
            lambda x: min_transcript_len <= x["transcript_len"] <= max_transcript_len,
            num_proc=num_proc,
        )
        print(f"Count after transcript length filtering: {len(ds)}")
        if len(ds) == 0:
            processed_datasets[split] = ds
            continue

        if apply_outlier_filtering and len(ds) > 10:
            print(f"Calculating duration/length ratio using '{duration_column}' for outlier detection...")
            ds = ds.map(calculate_duration_length_ratio, num_proc=num_proc)

            ratios = [r for r in ds["duration_len_ratio"] if pd.notna(r) and not math.isinf(r)]
            if not ratios:
                print("Warning: No valid ratios found for outlier calculation. Skipping outlier filtering.")
            else:
                mean_ratio = np.mean(ratios)
                std_ratio = np.std(ratios)

                if std_ratio <= 1e-6:
                    print("Warning: Standard deviation of ratio is zero or very small. Skipping outlier filtering.")
                else:
                    min_r_thresh = mean_ratio - outlier_std_devs * std_ratio
                    max_r_thresh = mean_ratio + outlier_std_devs * std_ratio
                    print(
                        f"Filtering outliers (ratio mean={mean_ratio:.2f}, std={std_ratio:.2f}). Keeping: {min_r_thresh:.2f} - {max_r_thresh:.2f}"
                    )
                    ds = ds.filter(
                        lambda x: (
                            pd.notna(x["duration_len_ratio"])
                            and min_r_thresh <= x["duration_len_ratio"] <= max_r_thresh
                        ),
                        num_proc=num_proc,
                    )
                    print(f"Count after outlier filtering: {len(ds)}")
            if "duration_len_ratio" in ds.column_names:
                ds = ds.remove_columns(["duration_len_ratio"])
        elif apply_outlier_filtering:
            print("Skipping outlier filtering: Not enough data points (<10) or apply_outlier_filtering is False.")

        processed_datasets[split] = ds
        final_count = len(ds)
        original_count = original_counts[split]
        removed_count = original_count - final_count
        percent_removed = (removed_count / original_count * 100) if original_count > 0 else 0
        print(
            f"--- Finished split: {split} --- Final count: {final_count} (Removed {removed_count}, {percent_removed:.2f}%)"
        )

    final_datasets = DatasetDict(processed_datasets)
    print("\nDataset processing complete.")
    return final_datasets["train"] if was_single_dataset else final_datasets


def create_vocabulary_from_data(
    datasets: DatasetDict,
    text_column: str,
    word_delimiter_token: Optional[str] = "|",
    unk_token: Optional[str] = "[UNK]",
    pad_token: Optional[str] = "[PAD]",
):
    # Given training and test labels create vocabulary
    def extract_all_chars(batch):
        all_text = " ".join(batch[text_column])
        vocab = list(set(all_text))
        return {"vocab": [vocab]}

    vocabs = datasets.map(
        extract_all_chars,
        batched=True,
        batch_size=-1,
        keep_in_memory=True,
        remove_columns=datasets["train"].column_names,
    )

    # take union of all unique characters in each dataset
    vocab_set = functools.reduce(
        lambda vocab_1, vocab_2: set(vocab_1["vocab"][0]) | set(vocab_2["vocab"][0]), [vocabs["train"], vocabs["validation"]]
    )

    vocab_dict = {v: k for k, v in enumerate(sorted(vocab_set))}

    # replace white space with delimiter token
    if word_delimiter_token is not None:
        vocab_dict[word_delimiter_token] = vocab_dict[" "]
        del vocab_dict[" "]

    # add unk and pad token
    if unk_token is not None:
        vocab_dict[unk_token] = len(vocab_dict)

    if pad_token is not None:
        vocab_dict[pad_token] = len(vocab_dict)

    return vocab_dict