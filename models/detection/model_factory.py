"""
Factory for creating object detection models following the article's approach.
"""
import torch
import torch.nn as nn
import torchvision
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from typing import Optional


def create_faster_rcnn_model(num_classes: int, pretrained: bool = True) -> nn.Module:
    """
    Create a Faster R-CNN model with optimized memory usage for GPUs
    """
    import os
    freeze_backbone = os.getenv("FREEZE_BACKBONE", "false").lower() == "true"
    
    # Optimize trainable backbone layers based on available VRAM
    trainable_layers = 3
    if torch.cuda.is_available():
        try:
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            if vram_gb < 10.0:
                trainable_layers = 2
                print(f"Detected GPU with {vram_gb:.2f}GB VRAM. Using trainable_backbone_layers={trainable_layers} to prevent CUDA OOM.")
        except Exception:
            pass

    try:
        model = torchvision.models.detection.fasterrcnn_resnet50_fpn(
            weights=torchvision.models.detection.FasterRCNN_ResNet50_FPN_Weights.DEFAULT if pretrained else None,
            trainable_backbone_layers=trainable_layers
        )
    except Exception:
        model = torchvision.models.detection.fasterrcnn_resnet50_fpn(
            pretrained=pretrained,
            trainable_backbone_layers=trainable_layers
        )

    # Get the number of input features for the classifier head
    in_features = model.roi_heads.box_predictor.cls_score.in_features

    # Replace the classifier head with a new one for the custom dataset's classes
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    
    # Freeze backbone if explicitly requested via FREEZE_BACKBONE env variable
    if freeze_backbone:
        print("Freezing Faster R-CNN backbone to save memory...")
        for param in model.backbone.parameters():
            param.requires_grad = False
    elif not torch.cuda.is_available():
        print("Notice: CUDA GPU is not available in environment. Running Faster R-CNN training on CPU.")
    
    print(f"Created Faster R-CNN with {num_classes} classes")
    print(f"Input features for classifier: {in_features}")

    return model


def create_ssd_model(num_classes: int, pretrained: bool = True) -> nn.Module:
    """
    Create a custom SSDLite model with MobileNetV3 Large backbone
    """
    try:
        model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
            weights=torchvision.models.detection.SSDLite320_MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
        )
    except Exception:
        model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(pretrained=pretrained)
    
    # Retrieve out channels of backbone
    in_channels = model.backbone.out_channels
    num_anchors = model.anchor_generator.num_anchors_per_location()
    
    from torchvision.models.detection.ssd import SSDHead
    model.head = SSDHead(in_channels, num_anchors, num_classes)
    
    import os
    freeze_backbone = os.getenv("FREEZE_BACKBONE", "false").lower() == "true"
    if freeze_backbone:
        print("Freezing SSD backbone to save memory...")
        for param in model.backbone.parameters():
            param.requires_grad = False
    elif not torch.cuda.is_available():
        print("Notice: CUDA GPU is not available in environment. Running SSD training on CPU.")
            
    print(f"Created SSDLite MobileNetV3 with {num_classes} classes")
    return model


def create_model(architecture: str, num_classes: int, pretrained: bool = True) -> nn.Module:
    """
    Create an object detection model based on architecture name
    
    Args:
        architecture: Name of the architecture (e.g., 'faster_rcnn', 'ssd')
        num_classes: Number of output classes (including background)
        pretrained: Whether to use pre-trained weights on COCO dataset
        
    Returns:
        Object detection model
    """
    if architecture == "faster_rcnn":
        return create_faster_rcnn_model(num_classes, pretrained)
    elif architecture == "ssd":
        return create_ssd_model(num_classes, pretrained)
    else:
        raise ValueError(f"Unsupported architecture: {architecture}. Supported: ['faster_rcnn', 'ssd']")