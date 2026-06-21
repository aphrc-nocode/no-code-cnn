import os
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import shutil
import tempfile

# Make sure workspace is in path
import sys
sys.path.append(str(Path(__file__).parent.parent.resolve()))

import minio_utils
from dataset_versioning import DatasetVersionManager

class TestMinIOIntegration(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.datasets_dir = self.temp_dir / "datasets"
        self.datasets_dir.mkdir()
        
        # Create a mock dataset
        self.dataset_id = "test_dataset_123"
        self.dataset_path = self.datasets_dir / self.dataset_id
        self.dataset_path.mkdir()
        
        # Add files to dataset
        with open(self.dataset_path / "dataset_config.json", "w") as f:
            f.write('{"task_type": "image_classification"}')
        
        class_dir = self.dataset_path / "class_a"
        class_dir.mkdir()
        with open(class_dir / "img1.png", "w") as f:
            f.write("fake png content")

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    @patch('minio_utils.Minio')
    def test_minio_utils_mocked(self, mock_minio):
        # Setup mock client
        mock_client = MagicMock()
        mock_minio.return_value = mock_client
        mock_client.bucket_exists.return_value = True
        
        # Reset minio_utils cache
        minio_utils._minio_client = None
        
        # Test file upload
        success = minio_utils.upload_file("test-bucket", "test-obj", str(self.dataset_path / "dataset_config.json"))
        self.assertTrue(success)
        mock_client.fput_object.assert_called_once()
        
        # Test directory upload
        mock_client.fput_object.reset_mock()
        success = minio_utils.upload_directory("test-bucket", "test-prefix", str(self.dataset_path))
        self.assertTrue(success)
        # Should call fput_object for dataset_config.json and class_a/img1.png
        self.assertEqual(mock_client.fput_object.call_count, 2)
        
        # Test directory download
        mock_client.list_objects.return_value = [
            MagicMock(object_name="test-prefix/dataset_config.json"),
            MagicMock(object_name="test-prefix/class_a/img1.png")
        ]
        
        dest_dir = self.temp_dir / "downloaded_dataset"
        success = minio_utils.download_directory("test-bucket", "test-prefix", str(dest_dir))
        self.assertTrue(success)
        self.assertEqual(mock_client.fget_object.call_count, 2)
        
        # Test exists
        mock_client.stat_object.return_value = MagicMock()
        self.assertTrue(minio_utils.exists("test-bucket", "test-prefix/dataset_config.json"))

    @patch('minio_utils.Minio')
    def test_dataset_versioning_with_mocked_minio(self, mock_minio):
        # Setup mock client
        mock_client = MagicMock()
        mock_minio.return_value = mock_client
        mock_client.bucket_exists.return_value = False
        
        # Reset minio_utils cache
        minio_utils._minio_client = None
        
        # Initialize DatasetVersionManager pointing to temp dir
        manager = DatasetVersionManager(str(self.datasets_dir))
        
        # Mock minio_utils exists to return True for registry
        with patch('minio_utils.exists', return_value=True), \
             patch('minio_utils.download_file', return_value=True), \
             patch('minio_utils.upload_file', return_value=True), \
             patch('minio_utils.upload_directory', return_value=True):
             
            # Test registering dataset
            version = manager.register_dataset(
                job_id=self.dataset_id,
                dataset_name="Test Upload",
                source="upload",
                parameters={"subset": "train"}
            )
            
            self.assertEqual(version.version_id, self.dataset_id)
            self.assertEqual(version.sample_count, 1)

if __name__ == '__main__':
    unittest.main()
