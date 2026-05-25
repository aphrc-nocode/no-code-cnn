"""
Class Balance Analysis for Dataset Fairness
Analyzes class distribution and provides recommendations for imbalanced datasets
"""

import numpy as np
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple, Any
from collections import Counter
import pandas as pd


class ClassBalanceAnalyzer:
    """Analyzes class balance in datasets and provides fairness insights"""
    
    def __init__(self):
        self.class_distribution = None
        self.imbalance_threshold = 0.1  # Classes with less than 10% of samples are considered imbalanced
        
    def analyze_class_distribution(self, labels: np.ndarray, class_names: List[str] = None) -> Dict[str, Any]:
        """
        Analyze the distribution of classes in the dataset
        
        Args:
            labels: Array of class labels
            class_names: Optional list of class names
            
        Returns:
            Dictionary containing class distribution analysis
        """
        # Count occurrences of each class
        label_counts = Counter(labels)
        total_samples = len(labels)
        
        # Calculate percentages
        label_percentages = {k: (v / total_samples) * 100 for k, v in label_counts.items()}
        
        # Sort by count
        sorted_labels = sorted(label_counts.items(), key=lambda x: x[1], reverse=True)
        
        # Calculate imbalance metrics
        max_count = sorted_labels[0][1]
        min_count = sorted_labels[-1][1]
        imbalance_ratio = max_count / min_count if min_count > 0 else float('inf')
        
        # Identify imbalanced classes
        imbalanced_classes = [
            (label, count, pct) 
            for label, count, pct in [
                (k, v, label_percentages[k]) 
                for k, v in sorted_labels
            ]
            if pct < self.imbalance_threshold * 100
        ]
        
        self.class_distribution = {
            'total_samples': total_samples,
            'num_classes': len(label_counts),
            'class_counts': dict(label_counts),
            'class_percentages': label_percentages,
            'imbalance_ratio': imbalance_ratio,
            'imbalanced_classes': imbalanced_classes,
            'is_balanced': len(imbalanced_classes) == 0
        }
        
        return self.class_distribution
    
    def get_balance_recommendations(self) -> List[str]:
        """
        Get recommendations for handling class imbalance
        
        Returns:
            List of recommendations
        """
        if self.class_distribution is None:
            return ["Please run analyze_class_distribution first"]
        
        recommendations = []
        
        if not self.class_distribution['is_balanced']:
            imbalance_ratio = self.class_distribution['imbalance_ratio']
            imbalanced_classes = self.class_distribution['imbalanced_classes']
            
            if imbalance_ratio > 10:
                recommendations.append(
                    f"SEVERE imbalance detected (ratio: {imbalance_ratio:.2f}). "
                    "Consider using oversampling (SMOTE) or undersampling techniques."
                )
            elif imbalance_ratio > 3:
                recommendations.append(
                    f"MODERATE imbalance detected (ratio: {imbalance_ratio:.2f}). "
                    "Consider using class weights in your loss function."
                )
            
            recommendations.append(
                f"Imbalanced classes: {', '.join([str(c[0]) for c in imbalanced_classes])}. "
                "These classes may need special attention during training."
            )
            
            recommendations.append(
                "Consider using stratified sampling during train/validation split."
            )
            
            recommendations.append(
                "Monitor per-class metrics (precision, recall, F1) during evaluation."
            )
        else:
            recommendations.append("Dataset appears to be well-balanced.")
        
        return recommendations
    
    def plot_class_distribution(self, save_path: str = None, figsize: Tuple[int, int] = (10, 6)):
        """
        Plot class distribution as a bar chart
        
        Args:
            save_path: Optional path to save the plot
            figsize: Figure size
        """
        if self.class_distribution is None:
            raise ValueError("Please run analyze_class_distribution first")
        
        class_counts = self.class_distribution['class_counts']
        class_percentages = self.class_distribution['class_percentages']
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=figsize)
        
        # Bar plot of counts
        classes = list(class_counts.keys())
        counts = list(class_counts.values())
        ax1.bar(range(len(classes)), counts, color='steelblue', alpha=0.8)
        ax1.set_xlabel('Class')
        ax1.set_ylabel('Number of Samples')
        ax1.set_title('Class Distribution (Counts)')
        ax1.set_xticks(range(len(classes)))
        ax1.set_xticklabels([str(c) for c in classes], rotation=45, ha='right')
        
        # Bar plot of percentages
        percentages = list(class_percentages.values())
        ax2.bar(range(len(classes)), percentages, color='coral', alpha=0.8)
        ax2.set_xlabel('Class')
        ax2.set_ylabel('Percentage (%)')
        ax2.set_title('Class Distribution (Percentages)')
        ax2.set_xticks(range(len(classes)))
        ax2.set_xticklabels([str(c) for c in classes], rotation=45, ha='right')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
        
        return fig
    
    def generate_balance_report(self) -> str:
        """
        Generate a text report on class balance
        
        Returns:
            Formatted text report
        """
        if self.class_distribution is None:
            return "Please run analyze_class_distribution first"
        
        report = []
        report.append("=" * 60)
        report.append("CLASS BALANCE ANALYSIS REPORT")
        report.append("=" * 60)
        report.append(f"\nTotal Samples: {self.class_distribution['total_samples']}")
        report.append(f"Number of Classes: {self.class_distribution['num_classes']}")
        report.append(f"Imbalance Ratio: {self.class_distribution['imbalance_ratio']:.2f}")
        report.append(f"Dataset Status: {'BALANCED' if self.class_distribution['is_balanced'] else 'IMBALANCED'}")
        
        report.append("\nClass Distribution:")
        for label, count in sorted(self.class_distribution['class_counts'].items()):
            pct = self.class_distribution['class_percentages'][label]
            report.append(f"  Class {label}: {count} samples ({pct:.2f}%)")
        
        if not self.class_distribution['is_balanced']:
            report.append("\nImbalanced Classes (< 10%):")
            for label, count, pct in self.class_distribution['imbalanced_classes']:
                report.append(f"  Class {label}: {count} samples ({pct:.2f}%)")
        
        report.append("\nRecommendations:")
        for rec in self.get_balance_recommendations():
            report.append(f"  - {rec}")
        
        report.append("=" * 60)
        
        return "\n".join(report)
    
    def calculate_class_weights(self, labels: np.ndarray, method: str = 'balanced') -> Dict[int, float]:
        """
        Calculate class weights for handling imbalance during training
        
        Args:
            labels: Array of class labels
            method: Method to calculate weights ('balanced', 'sqrt', 'log')
            
        Returns:
            Dictionary mapping class labels to weights
        """
        label_counts = Counter(labels)
        total_samples = len(labels)
        num_classes = len(label_counts)
        
        weights = {}
        
        if method == 'balanced':
            # Inverse frequency weighting
            for label, count in label_counts.items():
                weights[label] = total_samples / (num_classes * count)
        
        elif method == 'sqrt':
            # Square root inverse frequency
            for label, count in label_counts.items():
                weights[label] = np.sqrt(total_samples / (num_classes * count))
        
        elif method == 'log':
            # Logarithmic inverse frequency
            for label, count in label_counts.items():
                weights[label] = np.log1p(total_samples / (num_classes * count))
        
        else:
            raise ValueError(f"Unknown method: {method}. Use 'balanced', 'sqrt', or 'log'")
        
        return weights
