import React, { useEffect, useState, useRef } from 'react';

interface CursorProps {
  scale?: number;
}

export function CustomCursor({ scale = 1 }: CursorProps) {
  const [isPointer, setIsPointer] = useState(false);
  const [isText, setIsText] = useState(false);
  const [isDark, setIsDark] = useState(false);
  
  // Use refs for position tracking to avoid unnecessary re-renders
  const positionRef = useRef({ x: 0, y: 0 });
  const trailingRef = useRef({ x: 0, y: 0 });
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailingCursorRef = useRef<HTMLDivElement>(null);
  
  // Cache for clickable elements
  const clickableCache = useRef(new WeakMap<Element, boolean>());

  useEffect(() => {
    // Hide default cursor
    const style = document.createElement('style');
    style.textContent = `* { cursor: none !important; }`;
    document.head.appendChild(style);

    let lastCheckTime = 0;
    const CHECK_INTERVAL = 5; 

    const isClickable = (element: Element | null): boolean => {
      if (!element) return false;
      
      // Check cache first
      if (clickableCache.current.has(element)) {
        return clickableCache.current.get(element)!;
      }
      
      const result = (() => {
        // Check the element itself
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.cursor === 'pointer') return true;

        // Check for common clickable elements
        const tagName = element.tagName.toLowerCase();
        if (['button', 'a', 'input', 'select', 'textarea'].includes(tagName)) return true;
        
        // Check for role attributes
        const role = element.getAttribute('role');
        if (['button', 'link', 'menuitem', 'option', 'tab'].includes(role || '')) return true;

        // Check for common interactive classes
        const classList = Array.from(element.classList);
        if (classList.some(cls => 
          cls.includes('button') || 
          cls.includes('clickable') || 
          cls.includes('interactive')
        )) return true;

        // Check parent elements up to 2 levels (reduced for performance)
        let parent = element.parentElement;
        let level = 0;
        while (parent && level < 2) {
          if (clickableCache.current.has(parent)) {
            return clickableCache.current.get(parent)!;
          }
          if (isClickable(parent)) return true;
          parent = parent.parentElement;
          level++;
        }

        return false;
      })();

      // Cache the result
      clickableCache.current.set(element, result);
      return result;
    };

    const updateCursorTransform = () => {
      if (!cursorRef.current || !trailingCursorRef.current) return;
      
      const { x, y } = positionRef.current;
      cursorRef.current.style.transform = `translate(${x}px, ${y}px)`;

      // Update trailing cursor with smooth follow
      const dx = x - trailingRef.current.x;
      const dy = y - trailingRef.current.y;
      
      // Only update if movement is significant
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        trailingRef.current.x += dx * 0.35;
        trailingRef.current.y += dy * 0.35;
        trailingCursorRef.current.style.transform = 
          `translate(${trailingRef.current.x}px, ${trailingRef.current.y}px)`;
      }
    };

    let animationFrame: number;
    const animate = () => {
      updateCursorTransform();
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);

    const checkCursorStyle = (e: MouseEvent) => {
      const currentTime = Date.now();
      if (currentTime - lastCheckTime < CHECK_INTERVAL) return;
      
      lastCheckTime = currentTime;
      positionRef.current = { x: e.clientX, y: e.clientY };
      
      const element = document.elementFromPoint(e.clientX, e.clientY);
      if (!element) return;

      const computedStyle = window.getComputedStyle(element);
      setIsText(
        computedStyle.cursor === 'text' || 
        element.tagName.toLowerCase() === 'input' || 
        element.tagName.toLowerCase() === 'textarea'
      );
      setIsPointer(isClickable(element));
    };

    // Check for dark mode
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    window.addEventListener('mousemove', checkCursorStyle, { passive: true });
    
    // Observer for dark mode changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    checkDarkMode();

    return () => {
      window.removeEventListener('mousemove', checkCursorStyle);
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.head.removeChild(style);
      clickableCache.current = new WeakMap();
    };
  }, []);

  // Base sizes adjusted by scale
  const outerSize = 28 * scale;
  const innerSize = isPointer ? 14 * scale : 8 * scale;
  const textOuterHeight = 28 * scale;

  return (
    <>
      {/* Trailing outer circle/pill */}
      <div
        ref={trailingCursorRef}
        className="fixed pointer-events-none"
        style={{
          width: isText ? 16 * scale : outerSize,
          height: isText ? textOuterHeight : outerSize,
          marginLeft: isText ? -8 * scale : -outerSize / 2,
          marginTop: isText ? -textOuterHeight / 2 : -outerSize / 2,
          zIndex: 9999
        }}
      >
        <div 
          className={`
            w-full h-full transition-transform duration-150
            ${isDark ? 'bg-gray-300/70' : 'bg-gray-600/70'}
            ${isText ? 'rounded-full' : 'rounded-full'}
          `}
          style={{
            transform: isPointer ? 'scale(1.2)' : 'scale(1)'
          }}
        />
      </div>

      {/* Main cursor dot/line */}
      <div
        ref={cursorRef}
        className="fixed pointer-events-none"
        style={{
          width: isText ? 2 * scale : innerSize,
          height: isText ? 24 * scale : innerSize,
          marginLeft: isText ? -1 * scale : -innerSize / 2,
          marginTop: isText ? -12 * scale : -innerSize / 2,
          zIndex: 9999
        }}
      >
        {isText ? (
          // Text cursor line
          <div 
            className={`
              w-full h-full rounded-full
              ${isDark ? 'bg-cyan' : 'bg-blue'}
            `}
          />
        ) : (
          // Regular or pointer cursor
          <div 
            className={`
              w-full h-full rounded-full transition-colors duration-150
              ${isPointer 
                ? isDark ? 'bg-cyan' : 'bg-blue'
                : isDark ? 'bg-black' : 'bg-white'
              }
            `}
          />
        )}
      </div>
    </>
  );
}