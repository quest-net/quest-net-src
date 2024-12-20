import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { Settings } from "lucide-react"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className="relative inline-flex h-auto border-b-grey dark:border-b-offwhite border-b-4 items-center justify-start w-full"
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    value?: string;
  }
>(({ className, value, children, ...props }, ref) => {
  // Special case for settings tab
  if (value === 'settings') {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className="absolute rounded-full right-2 inline-flex items-center justify-center whitespace-nowrap px-4 py-1 transition-all
           text-grey  dark:text-offwhite
          data-[state=active]:bg-grey data-[state=active]:text-offwhite 
          dark:data-[state=active]:bg-offwhite dark:data-[state=active]:text-grey
          focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50
          hover:bg-grey/10 dark:hover:bg-offwhite/10 duration-300"
        value={value}
        {...props}
      >
        <Settings className="w-6 h-6" />
      </TabsPrimitive.Trigger>
    )
  }

  // Default tab style
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className="inline-flex border-b-text items-center justify-center whitespace-nowrap px-[2vw] py-[0.5vh] font-['BrunoAceSC'] text-[2vh] font-medium transition-all
         text-grey  dark:text-offwhite
        data-[state=active]:bg-grey data-[state=active]:text-offwhite 
        dark:data-[state=active]:bg-offwhite dark:data-[state=active]:text-grey
        focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 duration-300"
      value={value}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className="h-[84vh] ring-offset-background focus-visible:outline-none"
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }