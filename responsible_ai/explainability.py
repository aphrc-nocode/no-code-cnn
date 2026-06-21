"""
LIME and SHAP Explainability for Model Predictions
Provides local and global explainability for model decisions
"""

import numpy as np
import torch
import torch.nn as nn
from typing import Dict, List, Any, Optional, Tuple
import matplotlib.pyplot as plt
from PIL import Image
import warnings

try:
    import lime
    import lime.lime_image
    from skimage.segmentation import mark_boundaries
    LIME_AVAILABLE = True
except ImportError:
    LIME_AVAILABLE = False
    warnings.warn("LIME not available. Install with: pip install lime scikit-image")

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    warnings.warn("SHAP not available. Install with: pip install shap")


class LimeExplainer:
    """LIME explainer for image classification models"""
    
    def __init__(self, model: nn.Module, device: str = 'cuda'):
        """
        Initialize LIME explainer
        
        Args:
            model: PyTorch model to explain
            device: Device to run model on
        """
        if not LIME_AVAILABLE:
            raise ImportError("LIME is not installed. Install with: pip install lime scikit-image")
        
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.explainer = None
        
    def _predict_fn(self, images: np.ndarray) -> np.ndarray:
        """
        Prediction function for LIME
        
        Args:
            images: Array of images (N, H, W, C)
            
        Returns:
            Predictions as probabilities
        """
        # Convert numpy images to torch tensors
        images = torch.from_numpy(images).permute(0, 3, 1, 2).float() / 255.0
        images = images.to(self.device)
        
        with torch.no_grad():
            outputs = self.model(images)
            if isinstance(outputs, tuple):
                outputs = outputs[0]
            probs = torch.softmax(outputs, dim=1)
        
        return probs.cpu().numpy()
    
    def explain_image(
        self, 
        image: np.ndarray, 
        target_class: Optional[int] = None,
        num_samples: int = 1000,
        top_labels: int = 5
    ) -> Dict[str, Any]:
        """
        Explain a single image using LIME
        
        Args:
            image: Input image as numpy array (H, W, C)
            target_class: Target class to explain (if None, uses top prediction)
            num_samples: Number of samples for LIME
            top_labels: Number of top labels to explain
            
        Returns:
            Dictionary containing explanation results
        """
        if self.explainer is None:
            self.explainer = lime.lime_image.LimeImageExplainer()
        
        # Get model prediction
        image_tensor = torch.from_numpy(image).permute(2, 0, 1).float() / 255.0
        image_tensor = image_tensor.unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            output = self.model(image_tensor)
            if isinstance(output, tuple):
                output = output[0]
            probs = torch.softmax(output, dim=1)
            prediction = probs.argmax(dim=1).item()
            confidence = probs[0, prediction].item()
        
        # Use target class if provided, otherwise use prediction
        target = target_class if target_class is not None else prediction
        
        # Generate explanation
        explanation = self.explainer.explain_instance(
            image,
            self._predict_fn,
            top_labels=top_labels,
            hide_color=0,
            num_samples=num_samples
        )
        
        # Get explanation for target class
        temp, mask = explanation.get_image_and_mask(
            target,
            positive_only=True,
            num_features=10,
            hide_rest=False
        )
        
        # Create visualization
        fig, ax = plt.subplots(1, 3, figsize=(15, 5))
        
        ax[0].imshow(image)
        ax[0].set_title('Original Image')
        ax[0].axis('off')
        
        ax[1].imshow(mark_boundaries(temp / 255.0, mask))
        ax[1].set_title(f'LIME Explanation (Class {target})')
        ax[1].axis('off')
        
        # Show positive and negative regions
        temp, mask = explanation.get_image_and_mask(
            target,
            positive_only=False,
            num_features=10,
            hide_rest=False
        )
        ax[2].imshow(mark_boundaries(temp / 255.0, mask))
        ax[2].set_title('LIME (Positive & Negative)')
        ax[2].axis('off')
        
        plt.tight_layout()
        
        return {
            'prediction': prediction,
            'confidence': confidence,
            'target_class': target,
            'explanation': explanation,
            'figure': fig,
            'top_labels': explanation.top_labels
        }
    
    def explain_batch(
        self, 
        images: List[np.ndarray], 
        target_classes: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        Explain a batch of images
        
        Args:
            images: List of images
            target_classes: Optional target classes for each image
            
        Returns:
            List of explanation results
        """
        results = []
        for i, image in enumerate(images):
            target = target_classes[i] if target_classes else None
            result = self.explain_image(image, target)
            results.append(result)
        return results


class ShapExplainer:
    """SHAP explainer for model predictions"""
    
    def __init__(self, model: nn.Module, device: str = 'cuda'):
        """
        Initialize SHAP explainer
        
        Args:
            model: PyTorch model to explain
            device: Device to run model on
        """
        if not SHAP_AVAILABLE:
            raise ImportError("SHAP is not installed. Install with: pip install shap")
        
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.explainer = None
        self.background_data = None
        
    def _predict_fn(self, images: torch.Tensor) -> np.ndarray:
        """
        Prediction function for SHAP
        
        Args:
            images: Tensor of images (N, C, H, W)
            
        Returns:
            Predictions as probabilities
        """
        images = images.to(self.device)
        
        with torch.no_grad():
            outputs = self.model(images)
            if isinstance(outputs, tuple):
                outputs = outputs[0]
            probs = torch.softmax(outputs, dim=1)
        
        return probs.cpu().numpy()
    
    def fit_background(self, background_images: torch.Tensor, num_samples: int = 100):
        """
        Fit background data for SHAP explainer
        
        Args:
            background_images: Background images for SHAP
            num_samples: Number of samples to use from background
        """
        # Sample background images
        if len(background_images) > num_samples:
            indices = np.random.choice(len(background_images), num_samples, replace=False)
            background_images = background_images[indices]
        
        self.background_data = background_images.to(self.device)
        
        # Create explainer
        self.explainer = shap.GradientExplainer(
            self.model,
            self.background_data
        )
    
    def explain_image(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Explain a single image using SHAP
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain
            
        Returns:
            Dictionary containing explanation results
        """
        if self.explainer is None:
            raise ValueError("Please call fit_background first")
        
        # Add batch dimension
        image = image.unsqueeze(0).to(self.device)
        
        # Get model prediction
        with torch.no_grad():
            output = self.model(image)
            if isinstance(output, tuple):
                output = output[0]
            probs = torch.softmax(output, dim=1)
            prediction = probs.argmax(dim=1).item()
            confidence = probs[0, prediction].item()
        
        # Use target class if provided, otherwise use prediction
        target = target_class if target_class is not None else prediction
        
        # Generate SHAP values
        shap_values = self.explainer.shap_values(image, ranked_outputs=1)
        
        # Get SHAP values for target class
        if isinstance(shap_values, list):
            shap_vals = shap_values[target] if target < len(shap_values) else shap_values[0]
        else:
            shap_vals = shap_values
        
        # Create visualization
        fig = plt.figure(figsize=(12, 4))
        
        # Original image
        plt.subplot(1, 3, 1)
        img_np = image[0].cpu().permute(1, 2, 0).numpy()
        # Denormalize if normalized (standard ImageNet normalization check: if values are negative or exceed 1.0)
        if img_np.min() < 0.0 or img_np.max() > 1.0:
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            img_np = img_np * std + mean
            img_np = np.clip(img_np, 0.0, 1.0)
        plt.imshow(img_np)
        plt.title(f'Original (Pred: {prediction}, Conf: {confidence:.2f})')
        plt.axis('off')
        
        # SHAP values
        plt.subplot(1, 3, 2)
        shap.image_plot([shap_vals[0]], image[0].cpu().numpy(), show=False)
        plt.title('SHAP Values')
        
        # Absolute SHAP values
        plt.subplot(1, 3, 3)
        abs_shap = np.abs(shap_vals[0]).mean(axis=0)
        plt.imshow(abs_shap, cmap='hot')
        plt.colorbar()
        plt.title('Absolute SHAP Importance')
        plt.axis('off')
        
        plt.tight_layout()
        
        return {
            'prediction': prediction,
            'confidence': confidence,
            'target_class': target,
            'shap_values': shap_vals,
            'figure': fig
        }
    
    def explain_batch(
        self, 
        images: torch.Tensor, 
        target_classes: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        Explain a batch of images
        
        Args:
            images: Batch of images (N, C, H, W)
            target_classes: Optional target classes for each image
            
        Returns:
            List of explanation results
        """
        results = []
        for i in range(len(images)):
            target = target_classes[i] if target_classes else None
            result = self.explain_image(images[i], target)
            results.append(result)
        return results
    
    def get_feature_importance(self, shap_values: np.ndarray) -> Dict[str, float]:
        """
        Calculate feature importance from SHAP values
        
        Args:
            shap_values: SHAP values for an image
            
        Returns:
            Dictionary of feature importance scores
        """
        # Calculate mean absolute SHAP values
        importance = np.abs(shap_values).mean(axis=(1, 2))
        
        return {
            'channel_0_importance': float(importance[0]),
            'channel_1_importance': float(importance[1]),
            'channel_2_importance': float(importance[2]),
            'total_importance': float(importance.sum())
        }
