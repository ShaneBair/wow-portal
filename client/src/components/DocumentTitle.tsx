import { useEffect } from "react";

interface DocumentTitleProps {
  children: string;
}

export function DocumentTitle({ children }: DocumentTitleProps) {
  useEffect(() => {
    document.title = children;
  }, [children]);

  return null;
}
