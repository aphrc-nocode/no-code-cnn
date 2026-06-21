"""
Dataset Card Template and Auto-Generation System
Automatically generates comprehensive data cards for transparency and validation
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
import json
import yaml

class DataCardGenerator:
    """Generates data cards with responsible AI and validation information"""
    
    def __init__(self):
        self.dataset_overview = {}
        self.validation_summary = {}
        self.class_distribution = {}
        self.fairness_considerations = {}
        self.intended_use = ""
    
    def set_dataset_overview(
        self,
        dataset_name: str,
        task_type: str,
        total_samples: int,
        num_classes: int,
        format_type: str
    ):
        """Set basic dataset information"""
        self.dataset_overview = {
            'dataset_name': dataset_name,
            'task_type': task_type,
            'total_samples': total_samples,
            'num_classes': num_classes,
            'format_type': format_type,
            'creation_date': datetime.now().strftime("%Y-%m-%d")
        }
    
    def set_validation_summary(
        self,
        missing_data: List[str],
        invalid_labels: List[str],
        data_anomalies: List[str],
        is_balanced: bool,
        balance_ratio: float
    ):
        """Set validation summary"""
        self.validation_summary = {
            'missing_data': missing_data,
            'invalid_labels': invalid_labels,
            'data_anomalies': data_anomalies,
            'is_balanced': is_balanced,
            'balance_ratio': balance_ratio
        }
    
    def set_class_distribution(self, distribution: Dict[str, int]):
        """Set class distribution"""
        self.class_distribution = distribution
        
    def set_fairness_considerations(self, considerations: List[str]):
        """Set fairness considerations"""
        self.fairness_considerations = considerations
        
    def set_intended_use(self, use_case: str):
        self.intended_use = use_case
        
    def generate_data_card(self) -> str:
        """Generate a comprehensive data card in markdown format"""
        card = []
        
        # Title
        card.append(f"# Data Card: {self.dataset_overview.get('dataset_name', 'Unknown Dataset')}")
        card.append("")
        
        # Overview
        card.append("## Dataset Overview")
        card.append(f"- **Task Type:** {self.dataset_overview.get('task_type', 'N/A')}")
        card.append(f"- **Total Samples:** {self.dataset_overview.get('total_samples', 0)}")
        card.append(f"- **Number of Classes:** {self.dataset_overview.get('num_classes', 0)}")
        card.append(f"- **Format:** {self.dataset_overview.get('format_type', 'N/A')}")
        card.append(f"- **Analyzed Date:** {self.dataset_overview.get('creation_date', 'N/A')}")
        card.append("")
        
        # Validation Summary
        card.append("## Data Validation Report")
        
        issues = 0
        if self.validation_summary.get('missing_data'):
            card.append("### Missing Data Found")
            for item in self.validation_summary['missing_data']:
                card.append(f"- {item}")
            card.append("")
            issues += 1
            
        if self.validation_summary.get('invalid_labels'):
            card.append("### Invalid Labels Found")
            for item in self.validation_summary['invalid_labels']:
                card.append(f"- {item}")
            card.append("")
            issues += 1
            
        if self.validation_summary.get('data_anomalies'):
            card.append("### Data Anomalies")
            for item in self.validation_summary['data_anomalies']:
                card.append(f"- {item}")
            card.append("")
            issues += 1
            
        if issues == 0:
            card.append("No missing data, invalid labels, or anomalies detected.")
            card.append("")
        
        # Class Distribution
        card.append("## Class Distribution")
        
        is_balanced = self.validation_summary.get('is_balanced', True)
        if is_balanced:
            card.append("**Balanced Dataset:** The classes are reasonably balanced.")
        else:
            ratio = self.validation_summary.get('balance_ratio', 0)
            card.append(f"**Unbalanced Dataset:** There is significant imbalance between classes (Min/Max Ratio: {ratio:.2f}). This may lead to model bias towards majority classes.")
        card.append("")
        
        if self.class_distribution:
            card.append("| Class Name | Count |")
            card.append("|---|---|")
            for cls, count in self.class_distribution.items():
                card.append(f"| {cls} | {count} |")
        card.append("")
        
        # Fairness & Bias
        card.append("## Fairness & Bias Considerations")
        if self.fairness_considerations:
            for consideration in self.fairness_considerations:
                card.append(f"- {consideration}")
        else:
            card.append("- Am I using a representative dataset? (Ensure your dataset is sampled in a way that represents your users.)")
            card.append("- Is there real-world / human bias in my data? (Consider historical biases that might be present in labels.)")
            card.append("- Check for demographic parity if sensitive attributes are present in images.")
        card.append("")
        
        return "\n".join(card)
