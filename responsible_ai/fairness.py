"""
Fairness Analysis for Model Subgroups
Analyzes model performance across different subgroups to detect bias
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
import matplotlib.pyplot as plt
import seaborn as sns


class FairnessAnalyzer:
    """Analyzes fairness across different subgroups in the dataset"""
    
    def __init__(self):
        self.subgroup_metrics = None
        self.fairness_metrics = None
        
    def analyze_subgroup_performance(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        subgroup_labels: np.ndarray,
        subgroup_names: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Analyze model performance across different subgroups
        
        Args:
            y_true: Ground truth labels
            y_pred: Predicted labels
            subgroup_labels: Array indicating subgroup membership for each sample
            subgroup_names: Optional names for each subgroup
            
        Returns:
            Dictionary containing subgroup performance metrics
        """
        unique_subgroups = np.unique(subgroup_labels)
        
        if subgroup_names is None:
            subgroup_names = [f"Subgroup_{i}" for i in unique_subgroups]
        
        subgroup_metrics = {}
        
        for subgroup, name in zip(unique_subgroups, subgroup_names):
            # Get indices for this subgroup
            mask = subgroup_labels == subgroup
            subgroup_y_true = y_true[mask]
            subgroup_y_pred = y_pred[mask]
            
            if len(subgroup_y_true) == 0:
                continue
            
            # Calculate metrics for this subgroup
            metrics = {
                'accuracy': accuracy_score(subgroup_y_true, subgroup_y_pred),
                'precision': precision_score(subgroup_y_true, subgroup_y_pred, average='weighted', zero_division=0),
                'recall': recall_score(subgroup_y_true, subgroup_y_pred, average='weighted', zero_division=0),
                'f1': f1_score(subgroup_y_true, subgroup_y_pred, average='weighted', zero_division=0),
                'sample_count': len(subgroup_y_true)
            }
            
            subgroup_metrics[name] = metrics
        
        self.subgroup_metrics = subgroup_metrics
        return subgroup_metrics
    
    def calculate_fairness_metrics(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        subgroup_labels: np.ndarray,
        privileged_group: int = 0
    ) -> Dict[str, Any]:
        """
        Calculate fairness metrics comparing privileged vs unprivileged groups
        
        Args:
            y_true: Ground truth labels
            y_pred: Predicted labels
            subgroup_labels: Array indicating subgroup membership
            privileged_group: Index of privileged group
            
        Returns:
            Dictionary containing fairness metrics
        """
        # Get subgroup performance
        subgroup_metrics = self.analyze_subgroup_performance(y_true, y_pred, subgroup_labels)
        
        unique_subgroups = np.unique(subgroup_labels)
        privileged_metrics = subgroup_metrics[f"Subgroup_{privileged_group}"]
        
        fairness_metrics = {}
        
        for subgroup in unique_subgroups:
            if subgroup == privileged_group:
                continue
            
            unprivileged_metrics = subgroup_metrics[f"Subgroup_{subgroup}"]
            
            # Calculate disparity ratios
            accuracy_ratio = unprivileged_metrics['accuracy'] / (privileged_metrics['accuracy'] + 1e-8)
            precision_ratio = unprivileged_metrics['precision'] / (privileged_metrics['precision'] + 1e-8)
            recall_ratio = unprivileged_metrics['recall'] / (privileged_metrics['recall'] + 1e-8)
            f1_ratio = unprivileged_metrics['f1'] / (privileged_metrics['f1'] + 1e-8)
            
            fairness_metrics[f"Subgroup_{subgroup}_vs_Privileged"] = {
                'accuracy_ratio': accuracy_ratio,
                'precision_ratio': precision_ratio,
                'recall_ratio': recall_ratio,
                'f1_ratio': f1_ratio,
                'accuracy_disparity': abs(unprivileged_metrics['accuracy'] - privileged_metrics['accuracy']),
                'precision_disparity': abs(unprivileged_metrics['precision'] - privileged_metrics['precision']),
                'recall_disparity': abs(unprivileged_metrics['recall'] - privileged_metrics['recall']),
                'f1_disparity': abs(unprivileged_metrics['f1'] - privileged_metrics['f1'])
            }
        
        # Overall fairness assessment
        min_ratio = min([
            metrics['accuracy_ratio'] 
            for metrics in fairness_metrics.values()
        ])
        
        fairness_metrics['overall_fairness'] = {
            'min_accuracy_ratio': min_ratio,
            'is_fair': min_ratio >= 0.8,  # 80% rule
            'fairness_threshold': 0.8
        }
        
        self.fairness_metrics = fairness_metrics
        return fairness_metrics
    
    def calculate_demographic_parity(
        self,
        y_pred: np.ndarray,
        subgroup_labels: np.ndarray,
        positive_class: int = 1
    ) -> Dict[str, float]:
        """
        Calculate demographic parity (equal selection rates)
        
        Args:
            y_pred: Predicted labels
            subgroup_labels: Array indicating subgroup membership
            positive_class: Class considered as positive outcome
            
        Returns:
            Dictionary with demographic parity metrics
        """
        unique_subgroups = np.unique(subgroup_labels)
        
        selection_rates = {}
        for subgroup in unique_subgroups:
            mask = subgroup_labels == subgroup
            subgroup_pred = y_pred[mask]
            selection_rate = (subgroup_pred == positive_class).mean()
            selection_rates[f"Subgroup_{subgroup}"] = selection_rate
        
        # Calculate disparity
        max_rate = max(selection_rates.values())
        min_rate = min(selection_rates.values())
        disparity = max_rate - min_rate
        
        return {
            'selection_rates': selection_rates,
            'max_selection_rate': max_rate,
            'min_selection_rate': min_rate,
            'demographic_parity_disparity': disparity,
            'is_demographically_fair': disparity < 0.1  # 10% threshold
        }
    
    def calculate_equalized_odds(
        self,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        subgroup_labels: np.ndarray,
        positive_class: int = 1
    ) -> Dict[str, Any]:
        """
        Calculate equalized odds (equal TPR and FPR across subgroups)
        
        Args:
            y_true: Ground truth labels
            y_pred: Predicted labels
            subgroup_labels: Array indicating subgroup membership
            positive_class: Class considered as positive outcome
            
        Returns:
            Dictionary with equalized odds metrics
        """
        unique_subgroups = np.unique(subgroup_labels)
        
        tpr_rates = {}
        fpr_rates = {}
        
        for subgroup in unique_subgroups:
            mask = subgroup_labels == subgroup
            subgroup_y_true = y_true[mask]
            subgroup_y_pred = y_pred[mask]
            
            # True Positive Rate
            true_positives = ((subgroup_y_pred == positive_class) & (subgroup_y_true == positive_class)).sum()
            actual_positives = (subgroup_y_true == positive_class).sum()
            tpr = true_positives / actual_positives if actual_positives > 0 else 0
            
            # False Positive Rate
            false_positives = ((subgroup_y_pred == positive_class) & (subgroup_y_true != positive_class)).sum()
            actual_negatives = (subgroup_y_true != positive_class).sum()
            fpr = false_positives / actual_negatives if actual_negatives > 0 else 0
            
            tpr_rates[f"Subgroup_{subgroup}"] = tpr
            fpr_rates[f"Subgroup_{subgroup}"] = fpr
        
        # Calculate disparities
        tpr_disparity = max(tpr_rates.values()) - min(tpr_rates.values())
        fpr_disparity = max(fpr_rates.values()) - min(fpr_rates.values())
        
        return {
            'true_positive_rates': tpr_rates,
            'false_positive_rates': fpr_rates,
            'tpr_disparity': tpr_disparity,
            'fpr_disparity': fpr_disparity,
            'has_equalized_odds': tpr_disparity < 0.1 and fpr_disparity < 0.1
        }
    
    def plot_subgroup_performance(self, save_path: str = None, figsize: Tuple[int, int] = (12, 6)):
        """
        Plot subgroup performance comparison
        
        Args:
            save_path: Optional path to save the plot
            figsize: Figure size
        """
        if self.subgroup_metrics is None:
            raise ValueError("Please run analyze_subgroup_performance first")
        
        # Convert to DataFrame for easier plotting
        df = pd.DataFrame(self.subgroup_metrics).T
        
        fig, axes = plt.subplots(2, 2, figsize=figsize)
        
        # Accuracy
        df['accuracy'].plot(kind='bar', ax=axes[0, 0], color='steelblue', alpha=0.8)
        axes[0, 0].set_title('Accuracy by Subgroup')
        axes[0, 0].set_ylabel('Accuracy')
        axes[0, 0].set_xlabel('Subgroup')
        axes[0, 0].tick_params(axis='x', rotation=45)
        
        # Precision
        df['precision'].plot(kind='bar', ax=axes[0, 1], color='coral', alpha=0.8)
        axes[0, 1].set_title('Precision by Subgroup')
        axes[0, 1].set_ylabel('Precision')
        axes[0, 1].set_xlabel('Subgroup')
        axes[0, 1].tick_params(axis='x', rotation=45)
        
        # Recall
        df['recall'].plot(kind='bar', ax=axes[1, 0], color='seagreen', alpha=0.8)
        axes[1, 0].set_title('Recall by Subgroup')
        axes[1, 0].set_ylabel('Recall')
        axes[1, 0].set_xlabel('Subgroup')
        axes[1, 0].tick_params(axis='x', rotation=45)
        
        # F1 Score
        df['f1'].plot(kind='bar', ax=axes[1, 1], color='purple', alpha=0.8)
        axes[1, 1].set_title('F1 Score by Subgroup')
        axes[1, 1].set_ylabel('F1 Score')
        axes[1, 1].set_xlabel('Subgroup')
        axes[1, 1].tick_params(axis='x', rotation=45)
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        
        return fig
    
    def plot_fairness_comparison(self, save_path: str = None, figsize: Tuple[int, int] = (10, 6)):
        """
        Plot fairness metric comparison
        
        Args:
            save_path: Optional path to save the plot
            figsize: Figure size
        """
        if self.fairness_metrics is None:
            raise ValueError("Please run calculate_fairness_metrics first")
        
        # Extract ratio metrics
        ratio_data = []
        for key, metrics in self.fairness_metrics.items():
            if key == 'overall_fairness':
                continue
            ratio_data.append({
                'Comparison': key,
                'Accuracy Ratio': metrics['accuracy_ratio'],
                'Precision Ratio': metrics['precision_ratio'],
                'Recall Ratio': metrics['recall_ratio'],
                'F1 Ratio': metrics['f1_ratio']
            })
        
        df = pd.DataFrame(ratio_data)
        
        fig, ax = plt.subplots(figsize=figsize)
        
        x = np.arange(len(df))
        width = 0.2
        
        ax.bar(x - 1.5*width, df['Accuracy Ratio'], width, label='Accuracy', color='steelblue', alpha=0.8)
        ax.bar(x - 0.5*width, df['Precision Ratio'], width, label='Precision', color='coral', alpha=0.8)
        ax.bar(x + 0.5*width, df['Recall Ratio'], width, label='Recall', color='seagreen', alpha=0.8)
        ax.bar(x + 1.5*width, df['F1 Ratio'], width, label='F1', color='purple', alpha=0.8)
        
        ax.set_xlabel('Subgroup Comparison')
        ax.set_ylabel('Ratio to Privileged Group')
        ax.set_title('Fairness Metrics by Subgroup')
        ax.set_xticks(x)
        ax.set_xticklabels(df['Comparison'], rotation=45, ha='right')
        ax.legend()
        ax.axhline(y=1.0, color='red', linestyle='--', alpha=0.5, label='Perfect Fairness')
        ax.axhline(y=0.8, color='orange', linestyle='--', alpha=0.5, label='Fairness Threshold')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        
        return fig
    
    def generate_fairness_report(self) -> str:
        """
        Generate a comprehensive fairness report
        
        Returns:
            Formatted text report
        """
        if self.subgroup_metrics is None or self.fairness_metrics is None:
            return "Please run analyze_subgroup_performance and calculate_fairness_metrics first"
        
        report = []
        report.append("=" * 60)
        report.append("FAIRNESS ANALYSIS REPORT")
        report.append("=" * 60)
        
        report.append("\nSubgroup Performance:")
        for subgroup, metrics in self.subgroup_metrics.items():
            report.append(f"\n{subgroup}:")
            report.append(f"  Accuracy: {metrics['accuracy']:.4f}")
            report.append(f"  Precision: {metrics['precision']:.4f}")
            report.append(f"  Recall: {metrics['recall']:.4f}")
            report.append(f"  F1 Score: {metrics['f1']:.4f}")
            report.append(f"  Sample Count: {metrics['sample_count']}")
        
        report.append("\nFairness Metrics:")
        for comparison, metrics in self.fairness_metrics.items():
            if comparison == 'overall_fairness':
                continue
            report.append(f"\n{comparison}:")
            report.append(f"  Accuracy Ratio: {metrics['accuracy_ratio']:.4f}")
            report.append(f"  Precision Ratio: {metrics['precision_ratio']:.4f}")
            report.append(f"  Recall Ratio: {metrics['recall_ratio']:.4f}")
            report.append(f"  F1 Ratio: {metrics['f1_ratio']:.4f}")
            report.append(f"  Accuracy Disparity: {metrics['accuracy_disparity']:.4f}")
        
        report.append("\nOverall Fairness Assessment:")
        overall = self.fairness_metrics['overall_fairness']
        report.append(f"  Minimum Accuracy Ratio: {overall['min_accuracy_ratio']:.4f}")
        report.append(f"  Fairness Threshold: {overall['fairness_threshold']}")
        report.append(f"  Is Fair: {'YES' if overall['is_fair'] else 'NO'}")
        
        if not overall['is_fair']:
            report.append("\nRecommendations:")
            report.append("  - Consider collecting more data for underperforming subgroups")
            report.append("  - Apply reweighting techniques during training")
            report.append("  - Use adversarial debiasing methods")
            report.append("  - Monitor subgroup-specific metrics during training")
        
        report.append("=" * 60)
        
        return "\n".join(report)
    
    def get_mitigation_strategies(self) -> List[str]:
        """
        Get recommendations for mitigating fairness issues
        
        Returns:
            List of mitigation strategies
        """
        if self.fairness_metrics is None:
            return ["Please run calculate_fairness_metrics first"]
        
        strategies = []
        overall = self.fairness_metrics['overall_fairness']
        
        if not overall['is_fair']:
            strategies.append("Pre-processing:")
            strategies.append("  - Reweighting samples to balance subgroup representation")
            strategies.append("  - Oversample underrepresented subgroups")
            strategies.append("  - Remove or transform sensitive attributes if appropriate")
            
            strategies.append("\nIn-processing:")
            strategies.append("  - Add fairness constraints to the loss function")
            strategies.append("  - Use adversarial debiasing to remove subgroup information")
            strategies.append("  - Apply regularization to encourage similar performance across subgroups")
            
            strategies.append("\nPost-processing:")
            strategies.append("  - Adjust prediction thresholds per subgroup")
            strategies.append("  - Use calibrated equalized odds")
            strategies.append("  - Implement reject option classification")
            
            strategies.append("\nMonitoring:")
            strategies.append("  - Continuously monitor subgroup-specific metrics")
            strategies.append("  - Set up alerts for fairness degradation")
            strategies.append("  - Regular fairness audits and reviews")
        else:
            strategies.append("Model appears to be fair across subgroups.")
            strategies.append("Continue monitoring to maintain fairness.")
        
        return strategies
