import React, { useMemo } from 'react';

interface CircularProgressProps {
    percentage: number;
    size?: number;
    labelFontSize?: number;
    strokeWidth?: number;
    labelFontColor?: string;
    backStrokeColor?: string;
    color?: string;
    hasError?: boolean;
    checkMarkOnComplete?: boolean;
    checkMarkSize?: number;
    checkMarkColor?: string;
}

export const CircularProgress = ({
    percentage,
    size = 50,
    strokeWidth = 4,
    labelFontSize = 10,
    labelFontColor = "hsl(var(--muted-foreground))",
    backStrokeColor = "hsl(var(--border))",
    color = "hsl(var(--primary))",
    hasError = false,
    checkMarkSize = 14,
    checkMarkOnComplete = true,
    checkMarkColor = "hsl(var(--primary))",
}: CircularProgressProps) => {
    const progress = Math.floor(Math.max(0, Math.min(100, percentage)));

    const viewBox = useMemo<string>((): string => `0 0 ${size} ${size}`, [size]);
    const radius = useMemo<number>((): number => (size - strokeWidth) / 2, [size, strokeWidth]);
    const circumference = useMemo<number>((): number => radius * Math.PI * 2, [radius]);
    const dash = useMemo<number>((): number => (progress * circumference) / 100, [progress, circumference]);

    const activeColor = checkMarkOnComplete && progress >= 100 ? checkMarkColor : color;
    const textColor = checkMarkOnComplete && progress >= 100 ? checkMarkColor : labelFontColor;

    return (
        <svg width={size} height={size} viewBox={viewBox} aria-label='progress-circular-loader' style={{ display: 'block' }}>
            {/* Back Stroke Circle */}
            <circle
                fill='none'
                stroke={backStrokeColor}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={strokeWidth}
            />
            {/* Progress Stroke Circle */}
            <circle
                fill='none'
                stroke={activeColor}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={strokeWidth}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeLinecap='round'
                style={{ transition: 'stroke-dasharray 0.5s ease-in-out, stroke 0.5s ease' }}
            />
            {/* Center Label Text */}
            <text
                fill={textColor}
                fontSize={checkMarkOnComplete && progress >= 100 ? `${checkMarkSize}px` : `${labelFontSize}px`}
                fontWeight="700"
                textAnchor='middle'
                dominantBaseline="central"
                x='50%'
                y='50%'
            >
                {hasError ? 'N/A' : checkMarkOnComplete ? (progress < 100 ? `${progress}%` : '✓') : `${progress}%`}
            </text>
        </svg>
    );
};
