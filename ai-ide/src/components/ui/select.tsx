import * as React from "react"
import { cn } from "../../lib/utils"

type SelectRootProps = React.ComponentPropsWithoutRef<"div"> & {
  value?: string
  onValueChange?: (value: string) => void
}

const SelectContext = React.createContext<{ value?: string; onValueChange?: (v: string) => void } | null>(null)

const Select = React.forwardRef<React.ElementRef<"div">, SelectRootProps>(({ className, children, value, onValueChange, ...props }, ref) => (
  <SelectContext.Provider value={{ value, onValueChange }}>
    <div ref={ref} className={cn("relative", className)} {...props}>
      {children}
    </div>
  </SelectContext.Provider>
))
Select.displayName = "Select"

const SelectTrigger = React.forwardRef<React.ElementRef<"button">, React.ComponentPropsWithoutRef<"button">>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <svg className="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>
))
SelectTrigger.displayName = "SelectTrigger"

type SelectValueProps = React.ComponentPropsWithoutRef<"span"> & { placeholder?: string }
const SelectValue = React.forwardRef<React.ElementRef<"span">, SelectValueProps>(({ className, children, placeholder, ...props }, ref) => (
  <span ref={ref} className={cn("pointer-events-none", className)} {...props}>
    {children || placeholder}
  </span>
))
SelectValue.displayName = "SelectValue"

const SelectContent = React.forwardRef<React.ElementRef<"div">, React.ComponentPropsWithoutRef<"div">>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
      className
    )}
    {...props}
  >
    <div className="p-1">{children}</div>
  </div>
))
SelectContent.displayName = "SelectContent"

type SelectItemProps = React.ComponentPropsWithoutRef<"div"> & { value?: string }
const SelectItem = React.forwardRef<React.ElementRef<"div">, SelectItemProps>(({ className, children, value, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  return (
    <div
      ref={ref}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        className
      )}
      onClick={() => ctx?.onValueChange?.(value || '')}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {children}
    </div>
  )
})
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }