import React, { useState, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { ChevronsRight, Minus, Plus } from 'lucide-react';
import { imageManager } from '../../services/ImageManager';

interface BasicObjectViewProps {
  name: string;
  imageId?: string;
  id?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
  };
  onClick?: () => void;
  onEdit?: () => void;
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
  size = 'md',
  className = '',
  border,
  action,
  onClick,
  onEdit
}: BasicObjectViewProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      if (!imageId) return;

      const thumbnail = imageManager.getThumbnail(imageId);
      if (thumbnail && mounted) {
        setImageUrl(thumbnail);
      }

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

  const borderStyles = border ? {
    borderColor: border.color,
    borderWidth: border.width ? `${border.width}px` : '2px'
  } : undefined;

  const renderActionIcon = () => {
    if (!action?.icon) return null;
    
    const iconProps = {
      className: iconSizeClasses[size],
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
        <div className={`${textSizeClasses[size]} -rotate-45 font-medium`}>
          {action.content}
        </div>
      );
    }

    return (
      <div className={`-rotate-45 ${iconSizeClasses[size]}`}>
        {renderActionIcon()}
      </div>
    );
  };

  return (
    <div id={id} className={`relative inline-block ${action ? 'overflow-visible' : 'overflow-hidden'} ${onClick ? 'cursor-pointer hover:scale-105' : ''}`}>
      <div 
        onClick={onClick}
        className={`
          relative
          ${sizeClasses[size]}
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
                <p className="
                  text-offwhite
                  dark:text-grey
                  text-md
                  truncate
                  font-medium
                ">
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
                ${nameSizeClasses[size]}
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
              ${editButtonSizeClasses[size]}
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
                ${buttonSizeClasses[size]}
                rotate-45
                border-blue
                dark:border-cyan
                bg-offwhite
                dark:bg-grey
                text-blue
                dark:text-cyan
                rounded
                flex
                items-center
                justify-center
                hover:border-4
                disabled:border-grey
                disabled:text-grey
                dark:disabled:border-offwhite
                dark:disabled:text-offwhite
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
    </div>
  );
};

export default BasicObjectView;