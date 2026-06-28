"""
Factory for creating image classification models.
This module provides functionality to create various pre-trained models for image classification.
"""
import torch
import torch.nn as nn
from typing import Optional
import torchvision.models as models

def create_model(architecture: str, num_classes: int, pretrained: bool = True) -> nn.Module:
    """
    Create a model based on architecture name
    
    Args:
        architecture: Name of the architecture (e.g., 'resnet18', 'resnet50')
        num_classes: Number of output classes
        pretrained: Whether to use pre-trained weights (default: True)
        
    Returns:
        Neural network model
    """
    weights = 'IMAGENET1K_V1' if pretrained else None
    
    if architecture == "resnet18":
        model = models.resnet18(weights=weights)
        model.fc = nn.Linear(model.fc.in_features, num_classes)
    elif architecture == "resnet50":
        model = models.resnet50(weights=weights)
        model.fc = nn.Linear(model.fc.in_features, num_classes)
    elif architecture == "vgg16":
        model = models.vgg16(weights=weights)
        model.classifier[6] = nn.Linear(model.classifier[6].in_features, num_classes)
    elif architecture == "efficientnet":
        model = models.efficientnet_b0(weights=weights)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    elif architecture == "mobilenet":
        model = models.mobilenet_v2(weights=weights)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    else:
        raise ValueError(f"Unsupported architecture: {architecture}")
        
    return model
