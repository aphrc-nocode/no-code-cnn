# Responsible AI Toolkit for No-Code CNN Platform

A comprehensive toolkit for implementing responsible AI practices in computer vision models, including fairness analysis, explainability, and model transparency.

## Features

### 1. Class Balance Analysis
- **Location**: `class_balance.py`
- **Purpose**: Analyze class distribution in datasets to detect imbalances
- **Features**:
  - Calculate class distribution statistics
  - Identify imbalanced classes
  - Generate recommendations for handling imbalance
  - Calculate class weights for training
  - Visualize class distributions

### 2. Explainability (LIME/SHAP)
- **Location**: `explainability.py`
- **Purpose**: Provide local and global explainability for model predictions
- **Features**:
  - LIME explainer for image classification
  - SHAP explainer for model predictions
  - Batch explanation support
  - Feature importance analysis

### 3. GradCAM for Image Explainability
- **Location**: `gradcam.py`
- **Purpose**: Visual explanations for CNN predictions at inference time
- **Features**:
  - GradCAM heatmap generation
  - GradCAM++ for improved localization
  - Guided GradCAM for finer-grained explanations
  - Batch processing support
  - Visualization overlays

### 4. Fairness Subgroup Analysis
- **Location**: `fairness.py`
- **Purpose**: Analyze model performance across different subgroups to detect bias
- **Features**:
  - Subgroup performance metrics
  - Demographic parity calculation
  - Equalized odds analysis
  - Fairness metric comparisons
  - Mitigation strategy recommendations

### 5. Model Card Generation
- **Location**: `model_card.py`
- **Purpose**: Auto-generate comprehensive model cards following best practices
- **Features**:
  - Template-based model card generation
  - Auto-population from training results
  - Support for multiple formats (Markdown, JSON, YAML)
  - Includes fairness and explainability information
  - Ethical considerations section

### 6. Bias Information Resources
- **Location**: `bias_resources.py`
- **Purpose**: Comprehensive library of bias information and mitigation strategies
- **Features**:
  - Detailed bias type definitions
  - Real-world bias examples
  - Mitigation strategies (pre-processing, in-processing, post-processing)
  - Bias detection checklist
  - Search functionality
  - Bias report generation

## Installation

The toolkit dependencies are already added to `requirements.txt`:

```
lime>=0.2.0
shap>=0.41.0
scikit-image>=0.19.0
pyyaml>=6.0
```

Install dependencies:
```bash
pip install -r requirements.txt
```

## API Endpoints

The toolkit is integrated into the main API with the following endpoints:

### Class Balance Analysis
```http
POST /responsible-ai/class-balance
Content-Type: application/json

{
  "labels": [0, 1, 2, 0, 1, ...],
  "class_names": ["cat", "dog", "bird"]
}
```

### Fairness Analysis
```http
POST /responsible-ai/fairness-analysis
Content-Type: application/json

{
  "y_true": [0, 1, 2, 0, 1, ...],
  "y_pred": [0, 1, 1, 0, 2, ...],
  "subgroup_labels": [0, 1, 0, 1, 0, ...],
  "privileged_group": 0
}
```

### Model Card Generation
```http
POST /responsible-ai/generate-model-card
Content-Type: application/json

{
  "model_name": "ResNet50 Classifier",
  "model_architecture": "resnet50",
  "dataset_name": "ImageNet",
  "training_metrics": {
    "accuracy": 0.95,
    "precision": 0.94,
    "recall": 0.93,
    "f1": 0.94
  }
}
```

### Bias Information Resources
```http
GET /responsible-ai/bias-types
GET /responsible-ai/bias-examples?domain=image_classification
GET /responsible-ai/mitigation-strategies?stage=pre_processing
GET /responsible-ai/checklist?category=data_collection
POST /responsible-ai/bias-report
GET /responsible-ai/search?query=facial recognition
```

## Usage Examples

### Class Balance Analysis
```python
from responsible_ai import ClassBalanceAnalyzer

analyzer = ClassBalanceAnalyzer()
labels = [0, 1, 2, 0, 1, 0, 0, 1, 2, 2]
results = analyzer.analyze_class_distribution(labels)
recommendations = analyzer.get_balance_recommendations()
report = analyzer.generate_balance_report()
```

### Fairness Analysis
```python
from responsible_ai import FairnessAnalyzer

analyzer = FairnessAnalyzer()
subgroup_metrics = analyzer.analyze_subgroup_performance(y_true, y_pred, subgroup_labels)
fairness_metrics = analyzer.calculate_fairness_metrics(y_true, y_pred, subgroup_labels)
report = analyzer.generate_fairness_report()
```

### GradCAM Explainability
```python
from responsible_ai import GradCAMExplainer

explainer = GradCAMExplainer(model, target_layer='layer4')
result = explainer.explain_image(image_tensor)
```

### Model Card Generation
```python
from responsible_ai import ModelCardGenerator

generator = ModelCardGenerator()
generator.set_model_info("MyModel", "resnet50", "1.0", "classification")
generator.set_performance_metrics(0.95, 0.94, 0.93, 0.94)
model_card = generator.generate_model_card()
generator.save_model_card("model_card.md", format="markdown")
```

### Bias Resources
```python
from responsible_ai import BiasResourceLibrary

library = BiasResourceLibrary()
bias_types = library.bias_types
examples = library.get_bias_examples("image_classification")
strategies = library.get_mitigation_strategies("pre_processing")
report = library.generate_bias_report(["representation_bias", "label_bias"])
```

## Integration with Pipelines

The toolkit is integrated into the image classification pipeline:

- **Class balance analysis** is automatically run during model evaluation
- Results are included in the evaluation metrics
- Recommendations are logged to the job log

## Best Practices

1. **Always analyze class balance** before training to identify potential imbalances
2. **Use explainability tools** to understand model decisions
3. **Perform fairness analysis** when working with sensitive attributes
4. **Generate model cards** for all deployed models
5. **Consult bias resources** when designing data collection strategies
6. **Monitor fairness metrics** continuously in production
7. **Document limitations** and ethical considerations

## Bias Types Covered

- Selection Bias
- Label Bias
- Measurement Bias
- Historical Bias
- Representation Bias
- Aggregation Bias
- Algorithmic Bias
- Deployment Bias

## Mitigation Strategies

### Pre-processing
- Reweighting
- Resampling
- Data Augmentation
- Feature Removal/Transformation

### In-processing
- Fairness Constraints
- Adversarial Debiasing
- Regularization

### Post-processing
- Threshold Adjustment
- Calibrated Equalized Odds
- Reject Option Classification

## Contributing

When adding new responsible AI features:
1. Follow the existing module structure
2. Add comprehensive documentation
3. Include error handling
4. Update API endpoints
5. Add tests
6. Update this README

## License

This toolkit is part of the No-Code CNN Platform.
