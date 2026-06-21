"""
GradCAM (Gradient-weighted Class Activation Mapping) for Image Explainability
Provides visual explanations for CNN predictions at inference time
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import cv2
import matplotlib.pyplot as plt
from typing import Dict, List, Any, Optional, Tuple
from PIL import Image


class GradCAM:
    """GradCAM explainer for CNN models"""
    
    def __init__(self, model: nn.Module, target_layer: str = None, device: str = 'cuda'):
        """
        Initialize GradCAM explainer
        
        Args:
            model: PyTorch CNN model
            target_layer: Name of target layer for GradCAM (if None, uses last conv layer)
            device: Device to run model on
        """
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.target_layer = target_layer
        self.gradients = None
        self.activations = None
        self.hooks = []
        
        # Register hooks if target layer is specified
        if target_layer:
            self._register_hooks(target_layer)
        else:
            # Find last convolutional layer
            self._find_last_conv_layer()
    
    def _find_last_conv_layer(self):
        """Automatically find the last convolutional layer in the model"""
        last_conv = None
        for name, module in self.model.named_modules():
            if isinstance(module, nn.Conv2d):
                last_conv = (name, module)
        
        if last_conv:
            self.target_layer = last_conv[0]
            self._register_hooks(self.target_layer)
        else:
            raise ValueError("No convolutional layer found in the model")
    
    def _register_hooks(self, layer_name: str):
        """Register forward and backward hooks for the target layer"""
        def forward_hook(module, input, output):
            self.activations = output
        
        def backward_hook(module, grad_input, grad_output):
            self.gradients = grad_output[0]
        
        # Find the layer by name
        for name, module in self.model.named_modules():
            if name == layer_name:
                self.hooks.append(module.register_forward_hook(forward_hook))
                self.hooks.append(module.register_backward_hook(backward_hook))
                break
        else:
            raise ValueError(f"Layer {layer_name} not found in model")
    
    def _remove_hooks(self):
        """Remove all registered hooks"""
        for hook in self.hooks:
            hook.remove()
        self.hooks = []
    
    def generate_cam(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None,
        smooth: bool = True
    ) -> np.ndarray:
        """
        Generate GradCAM heatmap for an image
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain (if None, uses predicted class)
            smooth: Whether to apply smoothing to the heatmap
            
        Returns:
            GradCAM heatmap as numpy array
        """
        # Add batch dimension
        image = image.unsqueeze(0).to(self.device)
        image.requires_grad = True
        
        # Forward pass
        output = self.model(image)
        if isinstance(output, tuple):
            output = output[0]
        
        # Get target class
        if target_class is None:
            target_class = output.argmax(dim=1).item()
        
        # Backward pass for target class
        self.model.zero_grad()
        output[0, target_class].backward(retain_graph=True)
        
        # Get gradients and activations
        gradients = self.gradients  # (1, C, H, W)
        activations = self.activations  # (1, C, H, W)
        
        # Calculate weights
        weights = gradients.mean(dim=(2, 3), keepdim=True)  # (1, C, 1, 1)
        
        # Calculate weighted combination of activations
        cam = (weights * activations).sum(dim=1)  # (1, H, W)
        cam = F.relu(cam)  # Apply ReLU
        
        # Normalize to [0, 1]
        cam = cam.squeeze().cpu().detach().numpy()
        cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
        
        # Apply smoothing if requested
        if smooth:
            cam = cv2.GaussianBlur(cam, (5, 5), 0)
        
        # Resize to match original image size
        original_size = (image.shape[2], image.shape[3])
        cam = cv2.resize(cam, original_size)
        
        return cam
    
    def visualize_cam(
        self, 
        image: torch.Tensor, 
        cam: np.ndarray,
        alpha: float = 0.4,
        colormap: int = cv2.COLORMAP_JET
    ) -> np.ndarray:
        """
        Overlay GradCAM heatmap on original image
        
        Args:
            image: Original image tensor (C, H, W)
            cam: GradCAM heatmap
            alpha: Transparency of overlay
            colormap: OpenCV colormap to use
            
        Returns:
            Overlayed image as numpy array
        """
        # Convert image to numpy
        img_np = image.squeeze().cpu().detach().numpy().transpose(1, 2, 0)
        # Denormalize if normalized (standard ImageNet normalization check: if values are negative or exceed 1.0)
        if img_np.min() < 0.0 or img_np.max() > 1.0:
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            img_np = img_np * std + mean
            img_np = np.clip(img_np, 0.0, 1.0)
        img_np = (img_np * 255).astype(np.uint8)
        
        # Apply colormap to heatmap
        heatmap = cv2.applyColorMap((cam * 255).astype(np.uint8), colormap)
        heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)
        
        # Overlay heatmap on image
        overlay = cv2.addWeighted(img_np, 1 - alpha, heatmap, alpha, 0)
        
        return overlay
    
    def explain_image(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None,
        save_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Explain an image with GradCAM visualization
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain
            save_path: Optional path to save visualization
            
        Returns:
            Dictionary containing explanation results
        """
        # Get model prediction
        with torch.no_grad():
            output = self.model(image.unsqueeze(0).to(self.device))
            if isinstance(output, tuple):
                output = output[0]
            probs = F.softmax(output, dim=1)
            prediction = probs.argmax(dim=1).item()
            confidence = probs[0, prediction].item()
        
        # Generate CAM
        cam = self.generate_cam(image, target_class)
        
        # Create visualization
        fig, axes = plt.subplots(1, 3, figsize=(15, 5))
        
        # Original image
        img_np = image.squeeze().cpu().detach().numpy().transpose(1, 2, 0)
        # Denormalize if normalized (standard ImageNet normalization check: if values are negative or exceed 1.0)
        if img_np.min() < 0.0 or img_np.max() > 1.0:
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            img_np = img_np * std + mean
            img_np = np.clip(img_np, 0.0, 1.0)
        axes[0].imshow(img_np)
        axes[0].set_title(f'Original\nPred: {prediction} (Conf: {confidence:.2f})')
        axes[0].axis('off')
        
        # Heatmap
        axes[1].imshow(cam, cmap='jet')
        axes[1].set_title('GradCAM Heatmap')
        axes[1].axis('off')
        
        # Overlay
        overlay = self.visualize_cam(image, cam)
        axes[2].imshow(overlay)
        axes[2].set_title('Overlay')
        axes[2].axis('off')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        
        return {
            'prediction': prediction,
            'confidence': confidence,
            'target_class': target_class if target_class else prediction,
            'heatmap': cam,
            'overlay': overlay,
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
    
    def __del__(self):
        """Clean up hooks when object is destroyed"""
        self._remove_hooks()


# Alias to support import name used by the application
GradCAMExplainer = GradCAM

class GradCAMPlusPlus(GradCAM):
    """GradCAM++: Improved GradCAM with better localization"""
    
    def generate_cam(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None,
        smooth: bool = True
    ) -> np.ndarray:
        """
        Generate GradCAM++ heatmap for an image
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain
            smooth: Whether to apply smoothing
            
        Returns:
            GradCAM++ heatmap as numpy array
        """
        # Add batch dimension
        image = image.unsqueeze(0).to(self.device)
        image.requires_grad = True
        
        # Forward pass
        output = self.model(image)
        if isinstance(output, tuple):
            output = output[0]
        
        # Get target class
        if target_class is None:
            target_class = output.argmax(dim=1).item()
        
        # Backward pass
        self.model.zero_grad()
        output[0, target_class].backward(retain_graph=True)
        
        # Get gradients and activations
        gradients = self.gradients  # (1, C, H, W)
        activations = self.activations  # (1, C, H, W)
        
        # GradCAM++ calculation
        # Calculate alpha coefficients
        sum_grad_squared = torch.sum(gradients ** 2, dim=(2, 3), keepdim=True)
        sum_grad_cubed = torch.sum(gradients ** 3, dim=(2, 3), keepdim=True)
        alpha = sum_grad_squared / (2 * sum_grad_cubed + 1e-8)
        
        # Calculate weights
        weights = alpha * F.relu(gradients)
        
        # Calculate weighted combination
        cam = (weights * activations).sum(dim=1)
        cam = F.relu(cam)
        
        # Normalize
        cam = cam.squeeze().cpu().detach().numpy()
        cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
        
        # Apply smoothing
        if smooth:
            cam = cv2.GaussianBlur(cam, (5, 5), 0)
        
        # Resize
        original_size = (image.shape[2], image.shape[3])
        cam = cv2.resize(cam, original_size)
        
        return cam


class GuidedGradCAM(GradCAM):
    """Guided GradCAM: Combines GradCAM with guided backpropagation"""
    
    def generate_guided_backprop(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None
    ) -> np.ndarray:
        """
        Generate guided backpropagation visualization
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain
            
        Returns:
            Guided backpropagation visualization
        """
        # Add batch dimension
        image = image.unsqueeze(0).to(self.device)
        image.requires_grad = True
        
        # Forward pass
        output = self.model(image)
        if isinstance(output, tuple):
            output = output[0]
        
        # Get target class
        if target_class is None:
            target_class = output.argmax(dim=1).item()
        
        # Backward pass
        self.model.zero_grad()
        output[0, target_class].backward(retain_graph=True)
        
        # Get gradients
        gradients = image.grad.data  # (1, C, H, W)
        
        # Apply ReLU to gradients (guided backprop)
        guided_grad = F.relu(gradients)
        
        # Normalize
        guided_grad = guided_grad.squeeze().cpu().detach().numpy()
        guided_grad = (guided_grad - guided_grad.min()) / (guided_grad.max() - guided_grad.min() + 1e-8)
        
        return guided_grad
    
    def explain_image(
        self, 
        image: torch.Tensor, 
        target_class: Optional[int] = None,
        save_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Explain an image with Guided GradCAM
        
        Args:
            image: Input image tensor (C, H, W)
            target_class: Target class to explain
            save_path: Optional path to save visualization
            
        Returns:
            Dictionary containing explanation results
        """
        # Get model prediction
        with torch.no_grad():
            output = self.model(image.unsqueeze(0).to(self.device))
            if isinstance(output, tuple):
                output = output[0]
            probs = F.softmax(output, dim=1)
            prediction = probs.argmax(dim=1).item()
            confidence = probs[0, prediction].item()
        
        # Generate CAM
        cam = self.generate_cam(image, target_class)
        
        # Generate guided backprop
        guided_grad = self.generate_guided_backprop(image, target_class)
        
        # Multiply CAM with guided backprop
        guided_cam = cam * guided_grad.mean(axis=0)
        guided_cam = (guided_cam - guided_cam.min()) / (guided_cam.max() - guided_cam.min() + 1e-8)
        
        # Create visualization
        fig, axes = plt.subplots(1, 4, figsize=(20, 5))
        
        # Original image
        img_np = image.squeeze().cpu().detach().numpy().transpose(1, 2, 0)
        # Denormalize if normalized (standard ImageNet normalization check: if values are negative or exceed 1.0)
        if img_np.min() < 0.0 or img_np.max() > 1.0:
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            img_np = img_np * std + mean
            img_np = np.clip(img_np, 0.0, 1.0)
        axes[0].imshow(img_np)
        axes[0].set_title(f'Original\nPred: {prediction} (Conf: {confidence:.2f})')
        axes[0].axis('off')
        
        # GradCAM
        axes[1].imshow(cam, cmap='jet')
        axes[1].set_title('GradCAM')
        axes[1].axis('off')
        
        # Guided Backprop
        axes[2].imshow(guided_grad.mean(axis=0), cmap='gray')
        axes[2].set_title('Guided Backprop')
        axes[2].axis('off')
        
        # Guided GradCAM
        axes[3].imshow(guided_cam, cmap='jet')
        axes[3].set_title('Guided GradCAM')
        axes[3].axis('off')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        
        return {
            'prediction': prediction,
            'confidence': confidence,
            'target_class': target_class if target_class else prediction,
            'heatmap': cam,
            'guided_grad': guided_grad,
            'guided_cam': guided_cam,
            'figure': fig
        }
