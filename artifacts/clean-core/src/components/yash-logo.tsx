export function YashLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}yash-logo.png`}
      alt="YASH Technologies — More than what you think."
      width={511}
      height={306}
      className={`h-12 w-20 shrink-0 object-contain rounded bg-white p-1 ${className}`}
    />
  );
}
