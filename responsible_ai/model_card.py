"""
Model Card Template and Auto-Generation System
Automatically generates comprehensive model cards following best practices
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
import json
import yaml


class ModelCardGenerator:
    """Generates model cards with responsible AI information"""
    
    def __init__(self):
        self.model_info = {}
        self.dataset_info = {}
        self.training_info = {}
        self.performance_metrics = {}
        self.fairness_info = {}
        self.explainability_info = {}
        self.limitations = []
        self.intended_use = ""
        self.intended_users = ""
        self.out_of_scope_use = ""
        
    def set_model_info(
        self,
        model_name: str,
        model_architecture: str,
        model_version: str,
        model_type: str,
        framework: str = "PyTorch"
    ):
        """Set basic model information"""
        self.model_info = {
            'model_name': model_name,
            'model_architecture': model_architecture,
            'model_version': model_version,
            'model_type': model_type,
            'framework': framework,
            'creation_date': datetime.now().strftime("%Y-%m-%d")
        }
    
    def set_dataset_info(
        self,
        dataset_name: str,
        dataset_size: int,
        num_classes: int,
        data_source: str,
        data_preprocessing: str,
        class_distribution: Optional[Dict[str, int]] = None
    ):
        """Set dataset information"""
        self.dataset_info = {
            'dataset_name': dataset_name,
            'dataset_size': dataset_size,
            'num_classes': num_classes,
            'data_source': data_source,
            'data_preprocessing': data_preprocessing,
            'class_distribution': class_distribution
        }
    
    def set_training_info(
        self,
        training_time: str,
        hardware_used: str,
        hyperparameters: Dict[str, Any],
        training_data_split: Dict[str, float]
    ):
        """Set training information"""
        self.training_info = {
            'training_time': training_time,
            'hardware_used': hardware_used,
            'hyperparameters': hyperparameters,
            'training_data_split': training_data_split
        }
    
    def set_performance_metrics(
        self,
        accuracy: float,
        precision: float,
        recall: float,
        f1_score: float,
        additional_metrics: Optional[Dict[str, float]] = None
    ):
        """Set performance metrics"""
        self.performance_metrics = {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1_score': f1_score,
            'additional_metrics': additional_metrics or {}
        }
    
    def set_fairness_info(
        self,
        fairness_metrics: Dict[str, Any],
        demographic_parity: Optional[Dict[str, float]] = None,
        equalized_odds: Optional[Dict[str, Any]] = None,
        subgroup_analysis: Optional[Dict[str, Any]] = None
    ):
        """Set fairness information"""
        self.fairness_info = {
            'fairness_metrics': fairness_metrics,
            'demographic_parity': demographic_parity,
            'equalized_odds': equalized_odds,
            'subgroup_analysis': subgroup_analysis
        }
    
    def set_explainability_info(
        self,
        explainability_methods: List[str],
        lime_available: bool = False,
        shap_available: bool = False,
        gradcam_available: bool = False
    ):
        """Set explainability information"""
        self.explainability_info = {
            'explainability_methods': explainability_methods,
            'lime_available': lime_available,
            'shap_available': shap_available,
            'gradcam_available': gradcam_available
        }
    
    def add_limitation(self, limitation: str):
        """Add a limitation to the model card"""
        self.limitations.append(limitation)
    
    def set_use_cases(
        self,
        intended_use: str,
        intended_users: str,
        out_of_scope_use: str
    ):
        """Set use case information"""
        self.intended_use = intended_use
        self.intended_users = intended_users
        self.out_of_scope_use = out_of_scope_use
    
    def generate_model_card(self) -> str:
        """Generate a comprehensive model card in markdown format"""
        card = []
        
        # Title
        card.append(f"# Model Card: {self.model_info.get('model_name', 'Unknown Model')}")
        card.append("")
        
        # Model Details
        card.append("## Model Details")
        card.append("")
        card.append("- **Model Name:** " + self.model_info.get('model_name', 'N/A'))
        card.append("- **Architecture:** " + self.model_info.get('model_architecture', 'N/A'))
        card.append("- **Version:** " + self.model_info.get('model_version', 'N/A'))
        card.append("- **Type:** " + self.model_info.get('model_type', 'N/A'))
        card.append("- **Framework:** " + self.model_info.get('framework', 'N/A'))
        card.append("- **Creation Date:** " + self.model_info.get('creation_date', 'N/A'))
        card.append("")
        
        # Intended Use
        card.append("## Intended Use")
        card.append("")
        card.append("### Primary Use Cases")
        card.append(self.intended_use or "Not specified")
        card.append("")
        
        card.append("### Intended Users")
        card.append(self.intended_users or "Not specified")
        card.append("")
        
        card.append("### Out-of-Scope Use")
        card.append(self.out_of_scope_use or "Not specified")
        card.append("")
        
        # Dataset Information
        card.append("## Dataset Information")
        card.append("")
        card.append("- **Dataset Name:** " + self.dataset_info.get('dataset_name', 'N/A'))
        card.append("- **Dataset Size:** " + str(self.dataset_info.get('dataset_size', 'N/A')))
        card.append("- **Number of Classes:** " + str(self.dataset_info.get('num_classes', 'N/A')))
        card.append("- **Data Source:** " + self.dataset_info.get('data_source', 'N/A'))
        card.append("- **Data Preprocessing:** " + self.dataset_info.get('data_preprocessing', 'N/A'))
        card.append("")
        
        if self.dataset_info.get('class_distribution'):
            card.append("### Class Distribution")
            card.append("")
            for class_name, count in self.dataset_info['class_distribution'].items():
                card.append(f"- {class_name}: {count} samples")
            card.append("")
        
        # Training Information
        card.append("## Training Information")
        card.append("")
        card.append("- **Training Time:** " + self.training_info.get('training_time', 'N/A'))
        card.append("- **Hardware Used:** " + self.training_info.get('hardware_used', 'N/A'))
        card.append("")
        
        if self.training_info.get('hyperparameters'):
            card.append("### Hyperparameters")
            card.append("")
            for param, value in self.training_info['hyperparameters'].items():
                card.append(f"- {param}: {value}")
            card.append("")
        
        if self.training_info.get('training_data_split'):
            card.append("### Training Data Split")
            card.append("")
            for split, ratio in self.training_info['training_data_split'].items():
                card.append(f"- {split}: {ratio}")
            card.append("")
        
        # Performance Metrics
        card.append("## Performance Metrics")
        card.append("")
        card.append("- **Accuracy:** " + f"{self.performance_metrics.get('accuracy', 0):.4f}")
        card.append("- **Precision:** " + f"{self.performance_metrics.get('precision', 0):.4f}")
        card.append("- **Recall:** " + f"{self.performance_metrics.get('recall', 0):.4f}")
        card.append("- **F1 Score:** " + f"{self.performance_metrics.get('f1_score', 0):.4f}")
        card.append("")
        
        if self.performance_metrics.get('additional_metrics'):
            card.append("### Additional Metrics")
            card.append("")
            for metric, value in self.performance_metrics['additional_metrics'].items():
                card.append(f"- {metric}: {value}")
            card.append("")
        
        # Fairness Analysis
        card.append("## Fairness Analysis")
        card.append("")
        
        if self.fairness_info.get('fairness_metrics'):
            card.append("### Fairness Metrics")
            card.append("")
            for metric, value in self.fairness_info['fairness_metrics'].items():
                card.append(f"- {metric}: {value}")
            card.append("")
        
        if self.fairness_info.get('demographic_parity'):
            card.append("### Demographic Parity")
            card.append("")
            dp = self.fairness_info['demographic_parity']
            card.append(f"- **Disparity:** {dp.get('demographic_parity_disparity', 'N/A')}")
            card.append(f"- **Is Fair:** {dp.get('is_demographically_fair', 'N/A')}")
            card.append("")
        
        if self.fairness_info.get('equalized_odds'):
            card.append("### Equalized Odds")
            card.append("")
            eo = self.fairness_info['equalized_odds']
            card.append(f"- **TPR Disparity:** {eo.get('tpr_disparity', 'N/A')}")
            card.append(f"- **FPR Disparity:** {eo.get('fpr_disparity', 'N/A')}")
            card.append(f"- **Has Equalized Odds:** {eo.get('has_equalized_odds', 'N/A')}")
            card.append("")
        
        # Explainability
        card.append("## Explainability")
        card.append("")
        card.append("### Available Methods")
        card.append("")
        for method in self.explainability_info.get('explainability_methods', []):
            card.append(f"- {method}")
        card.append("")
        
        card.append("### Tool Availability")
        card.append("")
        card.append(f"- **LIME:** {'Available' if self.explainability_info.get('lime_available') else 'Not Available'}")
        card.append(f"- **SHAP:** {'Available' if self.explainability_info.get('shap_available') else 'Not Available'}")
        card.append(f"- **GradCAM:** {'Available' if self.explainability_info.get('gradcam_available') else 'Not Available'}")
        card.append("")
        
        # Limitations
        card.append("## Limitations")
        card.append("")
        if self.limitations:
            for i, limitation in enumerate(self.limitations, 1):
                card.append(f"{i}. {limitation}")
        else:
            card.append("No limitations specified.")
        card.append("")
        
        # Ethical Considerations
        card.append("## Ethical Considerations")
        card.append("")
        card.append("This model should be used responsibly and in accordance with ethical AI principles. Users should:")
        card.append("")
        card.append("- Verify model predictions in critical applications")
        card.append("- Monitor for performance degradation over time")
        card.append("- Ensure diverse and representative training data")
        card.append("- Regularly audit for bias and fairness")
        card.append("- Provide appropriate transparency to end users")
        card.append("")
        
        # Contact Information
        card.append("## Contact Information")
        card.append("")
        card.append("For questions or concerns about this model, please contact the development team.")
        card.append("")
        
        # Version History
        card.append("## Version History")
        card.append("")
        card.append(f"- **v{self.model_info.get('model_version', '1.0')}** - {self.model_info.get('creation_date', 'N/A')}: Initial release")
        card.append("")
        
        return "\n".join(card)
    
    def generate_json_model_card(self) -> Dict[str, Any]:
        """Generate model card as JSON dictionary"""
        return {
            'model_info': self.model_info,
            'dataset_info': self.dataset_info,
            'training_info': self.training_info,
            'performance_metrics': self.performance_metrics,
            'fairness_info': self.fairness_info,
            'explainability_info': self.explainability_info,
            'limitations': self.limitations,
            'intended_use': self.intended_use,
            'intended_users': self.intended_users,
            'out_of_scope_use': self.out_of_scope_use,
            'generated_date': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    
    def save_model_card(self, filepath: str, format: str = 'markdown'):
        """
        Save model card to file
        
        Args:
            filepath: Path to save the model card
            format: Format to save ('markdown', 'json', or 'yaml')
        """
        if format == 'markdown':
            content = self.generate_model_card()
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
        elif format == 'json':
            content = self.generate_json_model_card()
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(content, f, indent=2)
        elif format == 'yaml':
            content = self.generate_json_model_card()
            with open(filepath, 'w', encoding='utf-8') as f:
                yaml.dump(content, f, default_flow_style=False)
        else:
            raise ValueError(f"Unsupported format: {format}. Use 'markdown', 'json', or 'yaml'")
    
    def auto_populate_from_training(
        self,
        model_name: str,
        model_architecture: str,
        dataset_name: str,
        training_metrics: Dict[str, float],
        fairness_results: Optional[Dict[str, Any]] = None
    ):
        """
        Auto-populate model card from training results
        
        Args:
            model_name: Name of the model
            model_architecture: Architecture type
            dataset_name: Name of the dataset
            training_metrics: Dictionary of training metrics
            fairness_results: Optional fairness analysis results
        """
        # Set model info
        self.set_model_info(
            model_name=model_name,
            model_architecture=model_architecture,
            model_version="1.0",
            model_type="Image Classification",
            framework="PyTorch"
        )
        
        # Set performance metrics
        self.set_performance_metrics(
            accuracy=training_metrics.get('accuracy', 0.0),
            precision=training_metrics.get('precision', 0.0),
            recall=training_metrics.get('recall', 0.0),
            f1_score=training_metrics.get('f1', 0.0),
            additional_metrics={k: v for k, v in training_metrics.items() 
                              if k not in ['accuracy', 'precision', 'recall', 'f1']}
        )
        
        # Set fairness info if available
        if fairness_results:
            self.set_fairness_info(
                fairness_metrics=fairness_results.get('fairness_metrics', {}),
                demographic_parity=fairness_results.get('demographic_parity'),
                equalized_odds=fairness_results.get('equalized_odds'),
                subgroup_analysis=fairness_results.get('subgroup_analysis')
            )
        
        # Set explainability info
        self.set_explainability_info(
            explainability_methods=['GradCAM', 'LIME', 'SHAP'],
            gradcam_available=True,
            lime_available=True,
            shap_available=True
        )
        
        # Add default limitations
        self.add_limitation("Model performance may degrade on data significantly different from training data")
        self.add_limitation("Model may exhibit bias if training data is not representative")
        self.add_limitation("Model predictions should not be used as sole decision-making criteria in high-stakes applications")
        
        # Set default use cases
        self.set_use_cases(
            intended_use=f"Image classification for {dataset_name} dataset",
            intended_users="Researchers and developers working with image classification",
            out_of_scope_use="Medical diagnosis, legal decisions, or other high-stakes applications without proper validation"
        )
