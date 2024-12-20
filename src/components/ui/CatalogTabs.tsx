import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

const CatalogTabs = TabsPrimitive.Root;

const CatalogTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className="inline-flex h-10 items-center justify-center rounded-lg bg-transparent p-1"
    {...props}
  />
));
CatalogTabsList.displayName = TabsPrimitive.List.displayName;

const CatalogTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className="
      inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 
      font-['Mohave'] text-lg transition-all
      disabled:pointer-events-none disabled:opacity-50
      data-[state=active]:bg-grey data-[state=active]:text-offwhite
      data-[state=inactive]:bg-offwhite data-[state=inactive]:text-grey
      dark:data-[state=active]:bg-offwhite dark:data-[state=active]:text-grey
      dark:data-[state=inactive]:bg-grey dark:data-[state=inactive]:text-offwhite
      rounded-t-md mx-1
    "
    {...props}
  />
));
CatalogTabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const CatalogTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className="mt-2 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
    {...props}
  />
));
CatalogTabsContent.displayName = TabsPrimitive.Content.displayName;

export { CatalogTabs, CatalogTabsList, CatalogTabsTrigger, CatalogTabsContent };

export default CatalogTabs;