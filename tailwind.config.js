// tailwind.config.js
/*
Dark Mode Guide:
Light Mode -> Dark Mode
offwhite -> grey
grey -> offwhite
blue -> cyan
purple -> pink
magenta -> red
*/
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}", // this tells Tailwind which files to scan for classes
    ],
    darkMode: 'class',
    theme: {
      screens: {
        'sm': '640px',
        // => @media (min-width: 640px) { ... }

        'md': '768px',
        // => @media (min-width: 768px) { ... }

        'lg': '1024px',
        // => @media (min-width: 1024px) { ... }

        'xl': '1280px',
        // => @media (min-width: 1280px) { ... }

        '2xl': '1536px',
        // => @media (min-width: 1536px) { ... }
        '3xl': '2000px',
  
        '4xl': '2400px',
      },
      extend: {
        colors: {
          background: {
            DEFAULT: '#F2EEE4',
            dark: '#333233',
          },
          text: {
            DEFAULT: '#333233',
            dark: '#F2EEE4',
          },
          blue: {
            DEFAULT: '#0002FB',
          },
          purple: {
            DEFAULT: '#8A05FF',
          },
          magenta: {
            DEFAULT: '#FF009D',
          },
          cyan: {
            DEFAULT: '#00FBD1',
          },
          pink: {
            DEFAULT: '#D505FF',
          },
          red: {
            DEFAULT: '#FF0051',
          },
          offwhite:
          {
            DEFAULT: '#F2EEE4',
          },
          grey:
          {
            DEFAULT: '#333233',
          }
        },
        
      },
    },
    plugins: [],
  };