import React from 'react';


// Shared logic for all toggle variants
function useTheme() {
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  React.useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    }
  }, []);

  return { isDark, toggleTheme };
}

// Variant 1: Sliding Switch
export function SlidingToggle() {
  const { isDark, toggleTheme } = useTheme();
  
  return (
    <button
      onClick={toggleTheme}
      className={`
        relative inline-flex h-[1.5rem] w-[4rem] 2xl:h-8 2xl:w-20 items-center rounded-[0.9rem]
        border-2 border-[#333233] dark:border-[#F2EEE4]
        bg-[#F2EEE4] dark:bg-[#333233]
        transition-colors duration-1000
      `}
      aria-label="Toggle theme"
    >
      <span 
        className={`
          ${isDark ? 'translate-x-[2.4rem] 2xl:translate-x-12' : 'translate-x-1 -rotate-[360deg]'}
          inline-flex items-center justify-center
          w-[1.15rem] h-[1.15rem] 2xl:h-6 2xl:w-6 transform
          rounded-full
          border border-[#333233] dark:border-[#F2EEE4]
          bg-[#333233] dark:bg-[#F2EEE4]
          transition duration-1000
        `}
      >
        <div className="relative w-3 h-3 2xl:w-4 2xl:h-4">
          {/* Light mode star */}
          <svg
            className={`
              absolute inset-0 w-full h-full
              transition-all duration-1000
              ${isDark ? 'opacity-0 rotate-180 scale-50' : 'opacity-100 rotate-0 scale-100'}
            `}
            width="20" height="20" 
            viewBox="0 0 20 20" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              d="M10 0L12.1213 7.87868L20 10L12.1213 12.1213L10 20L7.87868 12.1213L0 10L7.87868 7.87868L10 0Z" 
              fill="#F2EEE4"
            />
          </svg>

          {/* Dark mode star */}
          <svg
            className={`
              absolute inset-0 w-full h-full
              transition-all duration-1000
              ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-180 scale-50'}
            `}
            width="20" height="20" 
            viewBox="0 0 20 20" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              d="M10 0L12.1213 7.87868L20 10L12.1213 12.1213L10 20L7.87868 12.1213L0 10L7.87868 7.87868L10 0Z" 
              fill="#333233"
            />
          </svg>
        </div>
      </span>
    </button>
  );
}


// Default export showing all variants
export default function ThemeToggles() {
  return (
    <div className="fixed top-4 right-4 flex flex-col gap-4">
      <SlidingToggle />
    </div>
  );
}