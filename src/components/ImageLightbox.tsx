import { useEffect } from 'react';
import { X } from 'lucide-react';

export function ImageLightbox({
  open,
  src,
  alt,
  onClose
}: {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md bg-white rounded-[28px] border border-[#E5E1D8] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 border border-[#E5E1D8] shadow-sm flex items-center justify-center text-[#606C38] hover:bg-[#F2F0E4] transition"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="bg-[#FBFBF8]">
          <img
            src={src}
            alt={alt || 'Image'}
            className="w-full h-auto max-h-[70vh] object-contain"
          />
        </div>
      </div>
    </div>
  );
}

