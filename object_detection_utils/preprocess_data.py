# object_detection_utils/preprocess_data.py

import argparse
import json
import os
import collections
import datasets

def preprocess_and_save_dataset(raw_data_dir: str, processed_data_dir: str):
    """
    Processes a raw COCO-style dataset and saves it to disk in Arrow format.
    """
    print(f"Starting preprocessing of data from '{raw_data_dir}'")
    
    # Define the features based on the expected COCO format
    # The 'image' feature will be loaded from the file path during processing.
    # We must extract the category names first to create the ClassLabel.
    try:
        with open(os.path.join(raw_data_dir, "train", "_annotations.coco.json"), "r") as f:
            data = json.load(f)
        categories = [cat["name"] for cat in data["categories"]]
    except Exception as e:
        raise RuntimeError(f"Could not read categories from train annotations: {e}")

    features = datasets.Features({
        "image_id": datasets.Value("int64"),
        "image": datasets.Image(),
        "width": datasets.Value("int32"),
        "height": datasets.Value("int32"),
        "objects": datasets.Sequence({
            "id": datasets.Value("int64"),
            "area": datasets.Value("int64"),
            "bbox": datasets.Sequence(datasets.Value("float32"), length=4),
            "category": datasets.ClassLabel(names=categories),
        }),
    })

    def generate_examples(split: str):
        """Generator function that yields examples for a given split."""
        annot_path = os.path.join(raw_data_dir, split, "_annotations.coco.json")
        if not os.path.exists(annot_path):
            print(f"Warning: Annotation file not found for split '{split}'. Skipping.")
            return

        with open(annot_path, "r") as f:
            data = json.load(f)

        category_id_to_name = {cat["id"]: cat["name"] for cat in data["categories"]}
        image_id_to_annotations = collections.defaultdict(list)
        for annot in data["annotations"]:
            image_id_to_annotations[annot["image_id"]].append(annot)
        
        # Main loop to generate examples
        for image_info in data["images"]:
            image_path = os.path.join(raw_data_dir, split, image_info["file_name"])
            if not os.path.exists(image_path):
                continue

            image_id = image_info["id"]
            
            # Format annotations for the current image
            objects = [{
                "id": annot["id"],
                "area": annot["area"],
                "bbox": annot["bbox"],
                "category": category_id_to_name[annot["category_id"]],
            } for annot in image_id_to_annotations[image_id]]
            
            yield image_id, {
                "image_id": image_id,
                "image": image_path,
                "width": image_info["width"],
                "height": image_info["height"],
                "objects": objects,
            }

    # Create a DatasetDict from the generators
    dataset_dict = datasets.DatasetDict()
    for split in ["train", "validation", "test"]:
        if os.path.exists(os.path.join(raw_data_dir, split)):
            print(f"Processing split: {split}")
            dataset_dict[split] = datasets.Dataset.from_generator(
                generate_examples,
                gen_kwargs={"split": split},
                features=features
            )
        else:
            print(f"Split '{split}' not found in raw data directory. Skipping.")

    # Save the processed dataset to disk
    print(f"Saving processed dataset to '{processed_data_dir}'...")
    dataset_dict.save_to_disk(processed_data_dir)
    print("Preprocessing complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert COCO-style data to Hugging Face Arrow format.")
    parser.add_argument("--raw_data_dir", type=str, required=True, help="Path to the raw data directory containing train/validation/test splits.")
    parser.add_argument("--processed_data_dir", type=str, required=True, help="Path to save the processed Arrow dataset.")
    args = parser.parse_args()
    
    preprocess_and_save_dataset(args.raw_data_dir, args.processed_data_dir)