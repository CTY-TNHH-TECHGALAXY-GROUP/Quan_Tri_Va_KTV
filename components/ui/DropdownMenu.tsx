import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export interface DropdownMenuOption {
  label: string;
  onClick: () => void;
}

export interface DropdownMenuProps {
  button: {
    label: string;
    size?: 'sm' | 'md' | 'lg';
  };
  items: DropdownMenuOption[];
}

export function DropdownMenu({ button, items }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-between w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none transition-colors min-w-[120px]"
      >
        <span className="truncate">{button.label}</span>
        <ChevronDown size={14} className="-mr-1 ml-2 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 z-50 bg-[#1e1e1e] text-white rounded-xl shadow-xl w-48 py-1.5 border border-zinc-800 text-[11px] font-medium min-w-[160px] animate-in fade-in zoom-in-95 duration-100 origin-top-left select-none">
          {/* Arrow */}
          <div className="absolute -top-1 left-4 w-2 h-2 bg-[#1e1e1e] border-t border-l border-zinc-800 rotate-45" />
          
          <div className="relative z-10">
            {items.map((item, index) => (
              <button
                key={index}
                onClick={() => {
                  item.onClick();
                  setIsOpen(false);
                }}
                className="block w-full text-left px-4 py-2 hover:bg-zinc-800 transition-colors text-gray-200 hover:text-white"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
