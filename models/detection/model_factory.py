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
    import os
    import torch
    import torch.nn as nn
    import torchvision

    model = None
    
    # 1. Try creating model directly with weights_backbone or pretrained_backbone for custom num_classes
    if pretrained:
        try:
            weights_backbone = torchvision.models.MobileNet_V3_Large_Weights.DEFAULT
            model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
                weights_backbone=weights_backbone,
                num_classes=num_classes
            )
        except Exception:
            try:
                model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
                    pretrained_backbone=True,
                    num_classes=num_classes
                )
            except Exception:
                pass

    # 2. If model could not be created above, create default and replace classification head
    if model is None:
        try:
            model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(
                weights=torchvision.models.detection.SSDLite320_MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
            )
        except Exception:
            model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(pretrained=pretrained)
        
        # Safely try to replace classification head for custom num_classes
        try:
            from torchvision.models.detection.ssd import SSDLiteClassificationHead
            in_channels = []
            for module in model.head.classification_head.module_list:
                for layer in module.modules():
                    if isinstance(layer, nn.Conv2d):
                        in_channels.append(layer.in_channels)
                        break

            num_anchors = model.anchor_generator.num_anchors_per_location()
            try:
                from torchvision.ops import FrozenBatchNorm2d
                norm_layer_cls = FrozenBatchNorm2d
            except Exception:
                norm_layer_cls = nn.BatchNorm2d

            model.head.classification_head = SSDLiteClassificationHead(
                in_channels=in_channels,
                num_anchors=num_anchors,
                num_classes=num_classes,
                norm_layer=norm_layer_cls
            )
        except Exception as e:
            print(f"Notice: SSDLite head replacement fallback ({e}). Replacing classification layers directly.")
            num_anchors = model.anchor_generator.num_anchors_per_location()
            for i, module in enumerate(model.head.classification_head.module_list):
                for name, layer in list(module.named_children()):
                    if isinstance(layer, nn.Conv2d):
                        in_ch = layer.in_channels
                        kernel_sz = layer.kernel_size
                        stride_val = layer.stride
                        padding_val = layer.padding
                        groups_val = layer.groups
                        setattr(module, name, nn.Conv2d(
                            in_ch, num_anchors[i] * num_classes,
                            kernel_size=kernel_sz, stride=stride_val,
                            padding=padding_val, groups=groups_val
                        ))
                        break

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