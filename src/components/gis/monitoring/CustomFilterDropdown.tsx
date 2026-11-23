'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';

export interface DropdownOption<T extends number | string = number> {
  value: T;
  label: string;
  sublabel?: string;
  badge?: string;
}

interface CustomFilterDropdownProps<T extends number | string = number> {
  label: string;
  value: T | null;
  placeholder?: string;
  options: DropdownOption<T>[];
  onChange: (value: T | null) => void;
  disabled?: boolean;
}

export function CustomFilterDropdown<T extends number | string = number>({
  label,
  value,
  placeholder = 'Semua',
  options,
  onChange,
  disabled = false,
}: CustomFilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && options.length > 5 && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, options.length]);

  const selectedOption = useMemo(
    () => options.find((opt) => String(opt.value) === String(value)),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase().trim();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  }, [options, searchQuery]);

  return (
    <div className="space-y-1.5 relative" ref={containerRef}>
      <label className="text-[11px] font-semibold text-[#8B9BB4] block">
        {label}
      </label>

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            setSearchQuery('');
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full min-h-10 lg:min-h-0 bg-[#12192B] border rounded-md px-2.5 py-2 lg:py-1.5 text-xs text-[#F0F6FC] transition-colors flex items-center justify-between text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#00D2FF] ${
          isOpen
            ? 'border-[#00D2FF] ring-1 ring-[#00D2FF]'
            : 'border-[#1E2942] hover:border-[#2C3B59]'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <div className="truncate pr-2">
          {selectedOption ? (
            <span className="font-medium text-[#F0F6FC]">{selectedOption.label}</span>
          ) : (
            <span className="text-[#8B9BB4]">{placeholder}</span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-[#8B9BB4] shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[#00D2FF]' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Floating Dropdown Menu with Max-Height and Smooth Dark Scrollbar */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-[#0D1322] border border-[#1E2942] rounded-lg shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Search box if options > 5 */}
          {options.length > 5 && (
            <div className="p-1.5 border-b border-[#1E2942] bg-[#12192B]/90">
              <input
                ref={searchInputRef}
                type="text"
                placeholder={`Cari ${label.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded px-2.5 py-1 text-xs text-[#F0F6FC] placeholder-[#566680] focus:outline-none"
              />
            </div>
          )}

          {/* Scrollable list */}
          <div className="max-h-56 overflow-y-auto p-1 space-y-0.5" role="listbox">
            {/* Opsi Reset (Semua) */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              role="option"
              aria-selected={value === null}
              className={`w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors flex items-center justify-between cursor-pointer ${
                value === null
                  ? 'bg-[#0E3A5D] text-[#00D2FF] font-semibold'
                  : 'text-[#8B9BB4] hover:bg-[#12192B] hover:text-[#F0F6FC]'
              }`}
            >
              <span>{placeholder}</span>
              {value === null && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF] shrink-0" />
              )}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="px-2.5 py-3 text-[11px] text-[#566680] text-center italic">
                Tidak ada data yang cocok
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    role="option"
                    aria-selected={isSelected}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[#0E3A5D] text-[#00D2FF] font-semibold'
                        : 'text-[#F0F6FC] hover:bg-[#12192B]'
                    }`}
                  >
                    <div className="truncate pr-2 min-w-0">
                      <div className="truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="text-[10px] text-[#8B9BB4] font-mono truncate">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF] shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
