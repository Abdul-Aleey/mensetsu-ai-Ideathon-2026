import { useRef, useState } from "react";

export default function FileDropZone({ label, accept, file, onChange, icon }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList) {
    const picked = fileList?.[0];
    if (picked) onChange(picked);
  }

  return (
    <div
      className={`drop-zone${dragOver ? " drop-zone--active" : ""}${file ? " drop-zone--filled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {icon && (
        <div className="drop-zone__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="drop-zone__label">{label}</p>
      {file ? (
        <p className="drop-zone__filename">{file.name}</p>
      ) : (
        <p className="drop-zone__hint">Drag &amp; drop, or click to choose a PDF or Word file</p>
      )}
    </div>
  );
}
