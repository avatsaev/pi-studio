/**
 * TextInput / TextArea — form input controls.
 * ui-components.md § Inputs & form controls (AdaptiveTextInput)
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { clsx } from "clsx";
import styles from "./TextInput.module.css";

// ---- TextInput ----

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(styles.input, className)}
        {...rest}
      />
    );
  },
);

// ---- TextArea ----

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(styles.input, styles.textarea, className)}
        {...rest}
      />
    );
  },
);
