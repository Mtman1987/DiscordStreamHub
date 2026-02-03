'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const sidebarVariants = cva(
  'flex flex-col bg-card text-card-foreground transition-all duration-300 ease-in-out',
  {
    variants: {
      collapsible: {
        true: 'data-[collapsed=true]:w-16 data-[collapsed=false]:w-64',
        false: 'w-64',
      },
    },
    defaultVariants: {
      collapsible: false,
    },
  }
);

interface SidebarContextProps {
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  collapsible: boolean;
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

const useSidebar = () => {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

const SidebarProvider = ({
  children,
  collapsible,
}: {
  children: React.ReactNode;
  collapsible?: boolean | 'icon';
}) => {
  const [isCollapsed, setCollapsed] = React.useState(collapsible === 'icon');

  return (
    <SidebarContext.Provider
      value={{ isCollapsed, setCollapsed, collapsible: !!collapsible }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isCollapsed, collapsible } = useSidebar();

  return (
    <div
      ref={ref}
      className={cn(sidebarVariants({ collapsible }), className)}
      data-collapsed={isCollapsed}
      {...props}
    />
  );
});
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-16 items-center',
        'group-data-[collapsed=true]:justify-center',
        className
      )}
      {...props}
    />
  );
});
SidebarHeader.displayName = 'SidebarHeader';

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex-1 overflow-y-auto', className)}
    {...props}
  />
));
SidebarContent.displayName = 'SidebarContent';

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('mt-auto border-t', className)} {...props} />
));
SidebarFooter.displayName = 'SidebarFooter';

const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, ...props }, ref) => {
  const { isCollapsed, setCollapsed } = useSidebar();

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      onClick={() => setCollapsed(!isCollapsed)}
      {...props}
    >
      {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
      <span className="sr-only">{isCollapsed ? 'Expand' : 'Collapse'}</span>
    </Button>
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul ref={ref} className={cn('space-y-2', className)} {...props} />
));
SidebarMenu.displayName = 'SidebarMenu';

const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.HTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
));
SidebarMenuItem.displayName = 'SidebarMenuItem';

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { isActive?: boolean; tooltip?: string }
>(
  (
    {
      className,
      variant = 'ghost',
      size = 'default',
      isActive,
      tooltip,
      children,
      ...props
    },
    ref
  ) => {
    const { isCollapsed } = useSidebar();

    const content = (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          'w-full justify-start gap-2',
          isActive && 'bg-primary/10 text-primary',
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );

    if (isCollapsed && tooltip) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right">
              <p>{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  }
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

const SidebarSeparator = React.forwardRef<
  HTMLHRElement,
  React.HTMLAttributes<HTMLHRElement>
>(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn('border-border', className)} {...props} />
));
SidebarSeparator.displayName = 'SidebarSeparator';

export {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
  useSidebar,
};
