// Framework-neutral design-system contracts; not a UI implementation.
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructiveOutline';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface AppButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void | Promise<void>;
}
export interface AppInputProps {
  label: string;
  value: string;
  helper?: string;
  error?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'tel' | 'numeric' | 'password' | 'date' | 'time';
  onChange: (value: string) => void;
}
export type RequestState = 'idle' | 'loading' | 'success' | 'error';
export type ApprovalState = 'draft' | 'submitted' | 'approved' | 'rejected';
export type PaymentState = 'unpaid' | 'pending_reconciliation' | 'partially_paid' | 'paid';
export type SyncState = 'synced' | 'pending' | 'failed';
export interface Scope {
  organizationId: string;
  campusId: string;
  userId: string;
  role: 'parent' | 'teacher' | 'principal';
}
// Actual native adapters must implement semantics, safe areas and text scaling.
