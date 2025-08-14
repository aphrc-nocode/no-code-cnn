import math
from typing import Union, Optional
import functools

import numpy as np
import pandas as pd
from datasets import Dataset, DatasetDict

from asr_utils.utils import clean_transcript


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

# def create_vocabulary_from_data(
#     datasets: DatasetDict,
#     text_column: str,
# ):
#     # take union of all unique characters in each dataset
#     vocab_set = set(" ".join(datasets['train'][text_column])) | set(" ".join(datasets['validation'][text_column]))
#     vocab_dict = {v: k for k, v in enumerate(sorted(vocab_set))}

#     return vocab_dict
