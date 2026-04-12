"use client";

import { useEffect, useRef, useState } from "react";
import type { UploadedImage } from "@/lib/types";

interface ImageUploaderProps {
  onUpload?: (image: UploadedImage) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  resetToken?: number;
}

export default function ImageUploader({
  onUpload,
  onError,
  disabled,
  resetToken = 0,
}: ImageUploaderProps) {
  const [image, setImage] = useState<UploadedImage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

  useEffect(() => {
    if (!image) return;
    URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [resetToken]);

  function handleFile(file: File | undefined) {
    if (!file || disabled) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Ugyldig filtype. Last opp et bilde (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      onError?.("Bildet er for stort. Maks filstørrelse er 8 MB.");
      return;
    }

    if (image) URL.revokeObjectURL(image.previewUrl);

    const uploaded: UploadedImage = {
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    };

    setImage(uploaded);
    onUpload?.(uploaded);
  }

  return (
    <div className="w-full">
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
          disabled
            ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
            : "cursor-pointer border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="mb-3 h-10 w-10 text-gray-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>

        {image ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src={image.previewUrl}
              alt="Forhåndsvisning"
              className="max-h-48 rounded-lg"
            />
            <p className="text-xs text-gray-500">
              {image.name} ({Math.round(image.size / 1024)} KB)
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">
              Klikk for å laste opp, eller dra og slipp
            </p>
            <p className="mt-1 text-xs text-gray-500">
              PNG, JPG eller skjermbilde
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        disabled={disabled}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
