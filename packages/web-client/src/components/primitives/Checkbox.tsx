/**
 * Checkbox — accessible checkbox control.
 * ui-components.md § Inputs & form controls
 */

import { type InputHTMLAttributes, type ReactNode, forwardRef } from "react";
import { Check } from "lucide-react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  checked?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, checked = false, disabled, className, onChange, ...rest }, ref) {
    return (
      <label className={styles.wrapper} data-disabled={disabled || undefined}>
        <input
          ref={ref}
          type="checkbox"
          className={styles.nativeInput}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          {...rest}
        />
        <span className={styles.box} data-checked={checked} aria-hidden>
          {checked && <Check size={12} className={styles.checkmark} />}
        </span>
        {label && <span>{label}</span>}
      </label>
    );
  },
);
