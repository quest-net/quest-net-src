import React from 'react';
import type { SVGProps } from 'react';

interface TabButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
  upsideDown?: boolean;
  className?: string;
}

const TabButton = ({ icon, title, onClick, upsideDown = false, className = '' }: TabButtonProps) => {
  return (
    <button 
      className="relative aspect-[4/3] min-w-[80px] w-full max-w-[100px] group"
      title={title}
      onClick={onClick}
    >
      {/* Tab shape */}
      <div className="absolute inset-0 overflow-visible">
        <svg 
          viewBox="0 0 134 89" 
          className={`w-full h-full overflow-visible ${upsideDown ? 'rotate-180' : ''}`}
          preserveAspectRatio="none"
        >
          <path 
            d="M51.6936 0C50.2645 0 48.944 0.762396 48.2295 2L1.4641 83C-0.0754968 85.6667 1.849 89 4.9282 89H129.636C132.715 89 134.64 85.6667 133.1 83L86.3346 2C85.6201 0.762395 84.2996 0 82.8705 0H51.6936Z"
            className={`
              fill-transparent
              stroke-blue 
              dark:stroke-cyan
              stroke-[3]
              group-hover:fill-grey/10
              dark:group-hover:fill-offwhite/10
              transition-colors
              drop-shadow-lg
            `}
          />
        </svg>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-9 h-9 text-blue dark:text-cyan scale-[1]">
          {React.isValidElement(icon) && 
            React.cloneElement(icon as React.ReactElement<SVGProps<SVGSVGElement>>, {
              className: `w-full h-full ${(icon.props as SVGProps<SVGSVGElement>).className || ''}`
            })}
          {!React.isValidElement(icon) && icon}
        </div>
      </div>
    </button>
  );
};

export default TabButton;