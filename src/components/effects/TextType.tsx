'use client';

import {
  ElementType,
  useEffect,
  useRef,
  useState,
  createElement,
  useMemo,
  useCallback,
} from 'react';
import { gsap } from 'gsap';

interface TextTypeProps {
  className?: string;
  showCursor?: boolean;
  hideCursorWhileTyping?: boolean;
  cursorCharacter?: string | React.ReactNode;
  cursorBlinkDuration?: number;
  cursorClassName?: string;
  text: string | string[];
  as?: ElementType;
  typingSpeed?: number;
  initialDelay?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
  loop?: boolean;
  textColors?: string[];
  variableSpeed?: { min: number; max: number };
  onSentenceComplete?: (sentence: string, index: number) => void;
  startOnVisible?: boolean;
  reverseMode?: boolean;

  /** Inline-editing props */
  editableAfter?: boolean;
  editOnClick?: boolean;
  editAutoFocus?: boolean;
  editClassName?: string;
  commitOnBlur?: boolean;
  enterToCommit?: boolean;
  escapeToCancel?: boolean;
  onEditCommit?: (value: string) => void;
  onEditCancel?: (value: string) => void;
  ariaLabelEditable?: string;

  /** NEW: max length + counter */
  maxLength?: number;
  showLengthCounter?: boolean;
  lengthCounterClassName?: string;
}

const TextType = ({
  text,
  as: Component = 'div',
  typingSpeed = 50,
  initialDelay = 0,
  pauseDuration = 2000,
  deletingSpeed = 30,
  loop = true,
  className = '',
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  cursorClassName = '',
  cursorBlinkDuration = 0.5,
  textColors = [],
  variableSpeed,
  onSentenceComplete,
  startOnVisible = false,
  reverseMode = false,

  // inline-editing
  editableAfter = false,
  editOnClick = true,
  editAutoFocus = false,
  editClassName = '',
  commitOnBlur = true,
  enterToCommit = true,
  escapeToCancel = true,
  onEditCommit,
  onEditCancel,
  ariaLabelEditable = 'Edit text',

  // NEW
  maxLength,
  showLengthCounter = false,
  lengthCounterClassName = '',
  ...props
}: TextTypeProps & React.HTMLAttributes<HTMLElement>) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(!startOnVisible);

  const [hasFinishedTyping, setHasFinishedTyping] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const blinkTweenRef = useRef<gsap.core.Tween | null>(null);

  const cursorRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLElement>(null);

  const textArray = useMemo(() => (Array.isArray(text) ? text : [text]), [text]);

  const getRandomSpeed = useCallback(() => {
    if (!variableSpeed) return typingSpeed;
    const { min, max } = variableSpeed;
    return Math.random() * (max - min) + min;
  }, [variableSpeed, typingSpeed]);

  const getCurrentTextColor = () => {
    if (textColors.length === 0) return;
    return textColors[currentTextIndex % textColors.length];
  };

  // Start on visible
  useEffect(() => {
    if (!startOnVisible || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setIsVisible(true);
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [startOnVisible]);

  

  // Typing effect
  useEffect(() => {
    if (!isVisible || isEditing) return;

    let timeout: NodeJS.Timeout;
    const currentText = textArray[currentTextIndex];
    const processedText = reverseMode ? currentText.split('').reverse().join('') : currentText;

    const finishSentence = () => {
      setHasFinishedTyping(true);
      if (onSentenceComplete) {
        onSentenceComplete(textArray[currentTextIndex], currentTextIndex);
      }
      if (editableAfter && editAutoFocus) {
        setIsEditing(true);
        // seed with possibly clamped value
        const seed = typeof maxLength === 'number'
          ? currentText.slice(0, maxLength)
          : currentText;
        setEditValue(seed);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };

    const executeTypingAnimation = () => {
      if (isDeleting) {
        if (displayedText === '') {
          setIsDeleting(false);
          if (currentTextIndex === textArray.length - 1 && !loop) {
            finishSentence();
            return;
          }
          if (onSentenceComplete) {
            onSentenceComplete(textArray[currentTextIndex], currentTextIndex);
          }
          setCurrentTextIndex((prev) => (prev + 1) % textArray.length);
          setCurrentCharIndex(0);
          timeout = setTimeout(() => {}, pauseDuration);
        } else {
          timeout = setTimeout(() => {
            setDisplayedText((prev) => prev.slice(0, -1));
          }, deletingSpeed);
        }
      } else {
        if (currentCharIndex < processedText.length) {
          timeout = setTimeout(() => {
            setDisplayedText((prev) => prev + processedText[currentCharIndex]);
            setCurrentCharIndex((prev) => prev + 1);
          }, variableSpeed ? getRandomSpeed() : typingSpeed);
        } else if (textArray.length > 1) {
          timeout = setTimeout(() => setIsDeleting(true), pauseDuration);
        } else {
          finishSentence();
        }
      }
    };

    if (currentCharIndex === 0 && !isDeleting && displayedText === '') {
      timeout = setTimeout(executeTypingAnimation, initialDelay);
    } else {
      executeTypingAnimation();
    }

    return () => clearTimeout(timeout);
  }, [
    isVisible,
    isEditing,
    textArray,
    currentTextIndex,
    currentCharIndex,
    displayedText,
    isDeleting,
    loop,
    initialDelay,
    pauseDuration,
    typingSpeed,
    deletingSpeed,
    variableSpeed,
    reverseMode,
    editableAfter,
    editAutoFocus,
    maxLength,
    onSentenceComplete,
  ]);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentCharIndex(0);
    setIsDeleting(false);
    setCurrentTextIndex(0);
    setHasFinishedTyping(false);
    setIsEditing(false);
    setEditValue('');
  }, [textArray.join('||')]);

  const shouldHideCursor =
    hideCursorWhileTyping &&
    (currentCharIndex < (textArray[currentTextIndex] || '').length || isDeleting);

  // Editing handlers
  const beginEditing = () => {
    if (!editableAfter || !hasFinishedTyping || isEditing) return;
    const seed = typeof maxLength === 'number'
      ? displayedText.slice(0, maxLength)
      : displayedText;
    setIsEditing(true);
    setEditValue(seed);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const next = typeof maxLength === 'number'
      ? editValue.slice(0, maxLength)
      : editValue;
    setIsEditing(false);
    setDisplayedText(next);
    setCurrentCharIndex(next.length);
    if (onEditCommit) onEditCommit(next);
  };

  const cancel = () => {
    setIsEditing(false);
    if (onEditCancel) onEditCancel(displayedText);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (enterToCommit && e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (escapeToCancel && e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (typeof maxLength === 'number' && val.length > maxLength) {
      setEditValue(val.slice(0, maxLength));
    } else {
      setEditValue(val);
    }
  };
  useEffect(() => {
	const el = cursorRef.current;
  
	// If we shouldn't show it right now, kill any existing tween
	if (!el || !showCursor || isEditing || shouldHideCursor) {
	  blinkTweenRef.current?.kill();
	  blinkTweenRef.current = null;
	  if (el) gsap.set(el, { opacity: 1 });
	  return;
	}
  
	// Recreate the tween whenever dependencies change
	blinkTweenRef.current?.kill();
	gsap.set(el, { opacity: 1 });
	blinkTweenRef.current = gsap.to(el, {
	  opacity: 0,
	  duration: cursorBlinkDuration,
	  repeat: -1,
	  yoyo: true,
	  ease: 'power2.inOut',
	});
  
	return () => {
	  blinkTweenRef.current?.kill();
	  blinkTweenRef.current = null;
	};
  }, [showCursor, cursorBlinkDuration, isEditing, shouldHideCursor]);
  return createElement(
    Component,
    {
      ref: containerRef,
      className: `inline-block whitespace-pre-wrap tracking-tight ${className} ${
        editableAfter && hasFinishedTyping ? 'cursor-text' : ''
      }`,
      onClick: editOnClick ? beginEditing : undefined,
      title: editableAfter && hasFinishedTyping ? 'Click to edit' : undefined,
      ...props,
    },
    isEditing ? (
      <span className="inline-flex items-baseline gap-2">
        <input
          ref={inputRef}
          aria-label={ariaLabelEditable}
          value={editValue}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={commitOnBlur ? commit : undefined}
          className={`bg-transparent w-90 outline-none border-b border-dashed border-base-content px-1 ${editClassName}`}
          // native cap as well
          {...(typeof maxLength === 'number' ? { maxLength } : {})}
        />
        {showLengthCounter && typeof maxLength === 'number' && (
          <span
            className={`text-xs opacity-70 select-none ${lengthCounterClassName}`}
            aria-live="polite"
          >
            {editValue.length}/{maxLength}
          </span>
        )}
      </span>
    ) : (
      <>
        <span className="inline" style={{ color: getCurrentTextColor() || 'inherit' }}>
          {displayedText}
        </span>
        {showCursor && !shouldHideCursor && (
          <span ref={cursorRef} className={`ml-1 inline-block ${cursorClassName}`}>
            {cursorCharacter}
          </span>
        )}
      </>
    )
  );
};

export default TextType;
