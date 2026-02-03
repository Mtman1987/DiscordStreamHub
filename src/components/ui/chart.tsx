'use client';

import * as React from 'react';
import type { TooltipProps } from 'recharts';

import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    label: string;
    color?: string;
  }
>;

export interface ChartTooltipContentProps extends TooltipProps<number, string> {
  className?: string;
  config?: ChartConfig;
  hideLabel?: boolean;
}

export const Chart = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('w-full', className)} {...props} />
));
Chart.displayName = 'Chart';

interface ChartContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig;
}

export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex aspect-video items-center justify-center gap-4 [&>div]:h-full [&>div]:w-full',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
ChartContainer.displayName = 'ChartContainer';

export const ChartLegend = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-3', className)} {...props} />
));
ChartLegend.displayName = 'ChartLegend';

export const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('space-y-1 text-sm', className)} {...props} />
));
ChartLegendContent.displayName = 'ChartLegendContent';

export const ChartStyle = React.forwardRef<
  HTMLStyleElement,
  React.HTMLAttributes<HTMLStyleElement>
>(({ ...props }, ref) => <style ref={ref} {...props} />);
ChartStyle.displayName = 'ChartStyle';

export const ChartTooltip = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'grid gap-2 rounded-md border bg-background/95 p-3 text-sm shadow-sm backdrop-blur',
      className,
    )}
    {...props}
  />
));
ChartTooltip.displayName = 'ChartTooltip';

export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipContentProps
>(({ active, payload, label, className, config, hideLabel }, ref) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <ChartTooltip ref={ref} className={className}>
      {!hideLabel && label ? (
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="grid gap-1">
        {payload.map((entry) => {
          const dataKey = entry.dataKey?.toString() ?? 'value';
          const meta = config?.[dataKey];
          const title = meta?.label ?? dataKey;
          const color = meta?.color ?? entry.color ?? 'hsl(var(--primary))';
          return (
            <div key={dataKey} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium">{title}</span>
              <span className="ml-auto font-semibold">{entry.value}</span>
            </div>
          );
        })}
      </div>
    </ChartTooltip>
  );
});
ChartTooltipContent.displayName = 'ChartTooltipContent';
