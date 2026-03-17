import React from 'react';
import { Bot } from 'lucide-react';

interface LogoProps {
  className?: string;
  iconClassName?: string;
}

export const Logo: React.FC<LogoProps> = ({ className = "w-6 h-6", iconClassName = "w-6 h-6 text-white" }) => {
  const [error, setError] = React.useState(false);

  if (error) {
    return <Bot className={iconClassName} />;
  }

  return (
    <img 
      src="/logo.png" 
      alt="Logo" 
      className={`${className} object-contain`}
      onError={() => setError(true)}
    />
  );
};
