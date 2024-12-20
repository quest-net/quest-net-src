import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Settings, Swords, Backpack, Scroll } from 'lucide-react';
import {ReactComponent as Sword} from '../ui/sword.svg';
import {ReactComponent as Bag} from '../ui/bag.svg';
import {ReactComponent as Star} from '../ui/star.svg';
import {ReactComponent as Gear} from '../ui/gear.svg';

const CoolTabs = TabsPrimitive.Root;

type TabType = 'equipment' | 'inventory' | 'skills' | 'settings';

interface CoolTabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  tabType: TabType;
}

const CoolTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className="inline-flex h-auto items-center justify-start w-full bg-transparent mx-4 relative gap-4"
    {...props}
  />
));
CoolTabsList.displayName = "CoolTabsList";

const TabIcon = ({ tabType, isActive }: { tabType: TabType; isActive: boolean }) => {
  const iconProps = {
    className: `w-8 h-8 group-data-[state=active]:text-offwhite group-data-[state=active]:dark:text-grey text-blue dark:text-cyan transition-colors`,
  };

  switch (tabType) {
    case 'equipment':
      return <Sword {...iconProps} />;
    case 'inventory':
      return <Bag {...iconProps} />;
    case 'skills':
      return <Star {...iconProps} />;
    case 'settings':
      return <Gear {...iconProps} />;
  }
};

const CoolTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  CoolTabsTriggerProps
>(({ className, tabType, ...props }, ref) => {
  const [isActive, setIsActive] = React.useState(false);

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      onMouseLeave={() => setIsActive(false)}
      className="relative h-14 w-20 group outline-none overflow-visible"
      {...props}
    >
      {/* Tab shape */}
      <div className="absolute inset-0 overflow-visible">
        <svg 
          viewBox="0 0 100 100" 
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <path 
            d="M35 0 L65 0 L100 100 L0 100 Z" 
            className={`
              fill-transparent
              stroke-blue dark:stroke-cyan
              stroke-[4]
              group-data-[state=active]:fill-blue
              dark:group-data-[state=active]:fill-cyan
              transition-colors
            `}
          />
        </svg>
      </div>
      
      {/* Icon container */}
      <div className="relative z-10 h-full flex items-center justify-center">
        <TabIcon 
          tabType={tabType} 
          isActive={isActive} 
        />
      </div>
    </TabsPrimitive.Trigger>
  );
});
CoolTabsTrigger.displayName = "CoolTabsTrigger";

const CoolTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className="h-full ring-offset-background focus-visible:outline-none border-[length:3px] border-blue dark:border-cyan rounded-xl"
    {...props}
  />
));
CoolTabsContent.displayName = "CoolTabsContent";

export { CoolTabs, CoolTabsList, CoolTabsTrigger, CoolTabsContent };

// Example usage
export default function CoolTabsDemo() {
  return (
    <CoolTabs defaultValue="equipment" className="w-full">
      <CoolTabsList>
        <CoolTabsTrigger value="equipment" tabType="equipment" />
        <CoolTabsTrigger value="inventory" tabType="inventory" />
        <CoolTabsTrigger value="skills" tabType="skills" />
        <CoolTabsTrigger value="settings" tabType="settings" />
      </CoolTabsList>
      <CoolTabsContent value="equipment">Equipment content</CoolTabsContent>
      <CoolTabsContent value="inventory">Inventory content</CoolTabsContent>
      <CoolTabsContent value="skills">Skills content</CoolTabsContent>
      <CoolTabsContent value="settings">Settings content</CoolTabsContent>
    </CoolTabs>
  );
}