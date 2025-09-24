import React, { useState, useEffect } from 'react';
import { MoreVertical, ChevronsRight, Minus, Plus } from 'lucide-react';
import { imageManager } from '../../services/ImageManager';

type Size = 'sm' | 'md' | 'lg' | 'xl';

interface ResponsiveSizeConfig {
  default: Size;
  xl?: Size;
  '2xl'?: Size;
  '3xl'?: Size;
}

interface BasicObjectViewProps {
  name: string;
  imageId?: string;
  id?: string;
  size: Size | ResponsiveSizeConfig | string;
  className?: string;
  border?: {
    color?: string;
    width?: number;
  };
  action?: {
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
    icon?: 'plus' | 'arrow' | 'minus';
    content?: string | number;
    disabled?: boolean;
    lightColor?: string;
    darkColor?: string;
  };
  onClick?: () => void;
  onEdit?: () => void;
  tooltip?: string;
}

const sizeClasses = {
  sm: 'w-28 h-28',
  md: 'w-36 h-36',
  lg: 'w-44 h-44',
  xl: 'w-60 h-60'
};

const nameSizeClasses = {
  sm: 'text-sm px-3',
  md: 'text-base px-4',
  lg: 'text-lg px-6',
  xl: 'text-xl px-10'
};

const buttonSizeClasses = {
  sm: 'w-10 h-10',
  md: 'w-12 h-12',
  lg: 'w-14 h-14',
  xl: 'w-16 h-16'
};

const iconSizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-6 h-6',
  lg: 'w-6 h-6',
  xl: 'w-6 h-6'
};

const textSizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl'
};

const editButtonSizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
  lg: 'w-8 h-8',
  xl: 'w-8 h-8'
};

const BasicObjectView = ({ 
  name, 
  imageId, 
  id,
  size: initialSize = 'md',
  className = '',
  border,
  action,
  onClick,
  onEdit,
  tooltip
}: BasicObjectViewProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentSize, setCurrentSize] = useState<Size>('md');
  const [showTooltip, setShowTooltip] = useState(false);

  // Parse size configuration
  useEffect(() => {
    const parseSizeConfig = () => {
      if (typeof initialSize === 'string') {
        if (initialSize in sizeClasses) {
          setCurrentSize(initialSize as Size);
        } else {
          // Parse string format "size=sm 2xl:size=md"
          const parts = initialSize.split(' ');
          let newSize: Size = 'md';

          parts.forEach(part => {
            if (part.includes(':')) {
              const [breakpoint, sizeStr] = part.split(':');
              const size = sizeStr.replace('size=', '') as Size;
              
              // Check if we meet the breakpoint condition
              if (breakpoint === '2xl' && window.innerWidth >= 1536 || 
                  breakpoint === 'xl' && window.innerWidth >= 1280 ||
                  breakpoint === '3xl' && window.innerWidth >= 1920) {
                newSize = size;
              }
            } else {
              const defaultSize = part.replace('size=', '') as Size;
              newSize = defaultSize;
            }
          });

          setCurrentSize(newSize);
        }
      } else if (typeof initialSize === 'object') {
        let newSize = initialSize.default;

        if (window.innerWidth >= 1920 && initialSize['3xl']) {
          newSize = initialSize['3xl'];
        } else if (window.innerWidth >= 1536 && initialSize['2xl']) {
          newSize = initialSize['2xl'];
        } else if (window.innerWidth >= 1280 && initialSize.xl) {
          newSize = initialSize.xl;
        }

        setCurrentSize(newSize);
      }
    };

    parseSizeConfig();

    const handleResize = () => {
      parseSizeConfig();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [initialSize]);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      if (!imageId) return;

      try {
        const imageData = await imageManager.getImage(imageId);
        if (imageData && mounted) {
          const url = URL.createObjectURL(imageData);
          setImageUrl(url);
          return () => URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error('Failed to load image:', error);
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [imageId]);

  // Tooltip handlers
  const handleMouseEnter = () => {
    if (tooltip) {
      setShowTooltip(true);
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const borderStyles = border ? {
    borderColor: border.color,
    borderWidth: border.width ? `${border.width}px` : '2px'
  } : undefined;

  const renderActionIcon = () => {
    if (!action?.icon) return null;
    
    const iconProps = {
      className: iconSizeClasses[currentSize],
      strokeWidth: 3
    };
    
    switch (action.icon) {
      case 'plus':
        return <Plus {...iconProps} />;
      case 'minus':
        return <Minus {...iconProps} />;
      case 'arrow':
        return <ChevronsRight {...iconProps} />;
      default:
        return null;
    }
  };

  const renderActionContent = () => {
    if (!action) return null;
    
    if (action.content !== undefined) {
      return (
        <div className={`${textSizeClasses[currentSize]} -rotate-45 font-medium`}>
          {action.content}
        </div>
      );
    }

    return (
      <div className={`-rotate-45 ${iconSizeClasses[currentSize]}`}>
        {renderActionIcon()}
      </div>
    );
  };

  // Generate action button colors
  const getActionButtonColors = () => {
    if (action?.lightColor && action?.darkColor) {
      return `
        border-${action.lightColor}
        dark:border-${action.darkColor}
        text-${action.lightColor}
        dark:text-${action.darkColor}
        disabled:border-${action.lightColor}
        disabled:text-${action.lightColor}
        dark:disabled:border-${action.darkColor}
        dark:disabled:text-${action.darkColor}
      `;
    }
    return `
      border-blue
      dark:border-cyan
      text-blue
      dark:text-cyan
      disabled:border-grey
      disabled:text-grey
      dark:disabled:border-offwhite
      dark:disabled:text-offwhite
    `;
  };

  return (
    <div id={id} className={`relative inline-block ${action ? 'overflow-visible' : 'overflow-hidden'} ${onClick ? 'cursor-pointer hover:scale-105' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      >
      <div 
        onClick={onClick}
        className={`
          relative
          ${sizeClasses[currentSize]}
          rounded-lg
          border-2
          border-grey
          dark:border-offwhite
          transition-all
          ${className}
        `}
        style={borderStyles}
      >
        {imageUrl ? (
          <>
            <img 
              src={imageUrl}
              alt={name}
              className="w-full h-full object-cover rounded-md"
            />
            {name && (
              <div className="
                absolute 
                top-0 
                left-0 
                right-0 
                px-2 
                py-1
                bg-grey/60
                dark:bg-offwhite/60
                rounded-t-md
              ">
                <p className={`
                  text-offwhite
                  dark:text-grey
                  ${nameSizeClasses[currentSize]}
                  truncate
                  font-medium
                `}>
                  {name}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="
            w-full 
            h-full 
            bg-gradient-to-br 
            from-blue 
            dark:from-cyan 
            to-transparent
            flex 
            items-center 
            justify-center
            rounded-md
          ">
            {name && (
              <p className={`
                text-offwhite
                dark:text-grey
                font-semibold
                text-lg
                font-['Mohave']
                text-center
                ${nameSizeClasses[currentSize]}
                break-words
              `}>
                {name}
              </p>
            )}
          </div>
        )}

        {/* Edit Button */}
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className={`
              absolute
              top-1
              right-0
              ${editButtonSizeClasses[currentSize]}
              rounded-lg
              bg-transparent
              hover:bg-black
              dark:hover:bg-white
              flex
              items-center
              justify-center
              transition-colors
              z-10
            `}
          >
            <MoreVertical className="w-4 h-4 text-offwhite dark:text-grey" />
          </button>
        )}

        {/* Action Button */}
        {action && (
          <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                action.onClick(e);
              }}
              disabled={action.disabled}
              className={`
                ${buttonSizeClasses[currentSize]}
                rotate-45
                ${getActionButtonColors()}
                bg-offwhite
                dark:bg-grey
                rounded
                flex
                items-center
                justify-center
                hover:border-4
                disabled:border-2
                disabled:cursor-not-allowed
                transition-opacity
                border-2
              `}
            >
              {renderActionContent()}
            </button>
          </div>
        )}
      </div>
      {/* NEW: Tooltip */}
      {tooltip && showTooltip && (
        <div className="absolute z-50 px-3 py-2 text-sm bg-black dark:bg-white text-white dark:text-black rounded-lg shadow-lg pointer-events-none
                        bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 whitespace-nowrap">
          {tooltip}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 
                          border-l-4 border-r-4 border-t-4 border-transparent border-t-black dark:border-t-white">
          </div>
        </div>
      )}
    </div>
  );
};

export default BasicObjectView;