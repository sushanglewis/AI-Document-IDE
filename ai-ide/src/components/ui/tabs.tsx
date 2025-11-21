import * as React from "react"
import { cn } from "../../lib/utils"

type TabsRootProps = React.ComponentPropsWithoutRef<"div"> & {
  value?: string
  onValueChange?: (value: string) => void
}

const TabsContext = React.createContext<{ value?: string; onValueChange?: (v: string) => void } | null>(null)

const Tabs = React.forwardRef<React.ElementRef<"div">, TabsRootProps>(({ className, value, onValueChange, ...props }, ref) => (
  <TabsContext.Provider value={{ value, onValueChange }}>
    <div ref={ref} className={cn("", className)} {...props} />
  </TabsContext.Provider>
))
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = "TabsList"

type TabsTriggerProps = React.ComponentPropsWithoutRef<"button"> & { value: string }
const TabsTrigger = React.forwardRef<React.ElementRef<"button">, TabsTriggerProps>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  const active = ctx?.value === value
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        active ? "bg-background text-foreground shadow-sm" : "",
        className
      )}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx?.onValueChange?.(value)}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

type TabsContentProps = React.ComponentPropsWithoutRef<"div"> & { value: string }
const TabsContent = React.forwardRef<React.ElementRef<"div">, TabsContentProps>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  const active = ctx?.value === value
  return (
    <div
      ref={ref}
      className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
      data-state={active ? "active" : "inactive"}
      hidden={!active}
      {...props}
    />
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }