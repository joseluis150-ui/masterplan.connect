"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileText, Download, Loader2, ExternalLink, AlertCircle,
} from "lucide-react";

/**
 * Dialog de preview de un adjunto. Decide cómo renderizar según el mime type
 * o la extensión del archivo:
 *   - PDF        → iframe ocupando la mayor parte del modal
 *   - Imagen     → <img> centrada con object-fit contain
 *   - Otros      → mensaje + botón de descarga, sin preview
 *
 * El parent maneja el flujo de descarga vía onDownload (para casos donde se
 * necesita generar un signed URL nuevo con flag de descarga). Si querés un
 * download "directo", podés pasar `directDownloadHref` y el componente usa
 * un <a download> sin involucrar al parent.
 */
export function AttachmentPreviewDialog({
  fileName,
  previewUrl,
  mimeType,
  onClose,
  onDownload,
  directDownloadHref,
}: {
  fileName: string;
  /** URL para mostrar el preview — signed URL inline o URL pública. */
  previewUrl: string;
  mimeType: string | null;
  onClose: () => void;
  /** Click en "Descargar" — el parent abre el attachment con flag download. */
  onDownload?: () => Promise<void> | void;
  /** Alternativa para casos donde la URL pública sirve directo: <a download>. */
  directDownloadHref?: string;
}) {
  const [downloading, setDownloading] = useState(false);

  const lowerName = fileName.toLowerCase();
  const isPdf = (mimeType || "").includes("pdf") || lowerName.endsWith(".pdf");
  const isImg =
    (mimeType || "").startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(fileName);

  async function handleDownload() {
    if (!onDownload) return;
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <FileText className="h-5 w-5 text-[#E87722] shrink-0" />
            <span className="truncate" title={fileName}>{fileName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Cuerpo: preview según tipo */}
        <div className="flex-1 overflow-hidden border rounded-md bg-neutral-50 min-h-[60vh]">
          {isPdf ? (
            <iframe
              src={previewUrl}
              title={fileName}
              className="w-full h-[70vh]"
              // Algunos browsers deshabilitan PDF inline si el server no
              // setea Content-Disposition correctamente. Si no se ve, el
              // usuario puede usar el botón "Abrir en pestaña".
            />
          ) : isImg ? (
            <div className="flex items-center justify-center h-[70vh] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center px-6">
              <AlertCircle className="h-10 w-10 mb-3 text-amber-500" />
              <p className="text-sm font-medium mb-1">Tipo de archivo no previsualizable</p>
              <p className="text-xs text-muted-foreground max-w-md">
                Este formato no se puede mostrar dentro del navegador. Usá el botón
                de descarga para abrirlo localmente.
              </p>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex justify-end gap-2 pt-2">
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 inline-flex items-center text-xs font-medium rounded border border-neutral-200 hover:bg-neutral-50 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Abrir en pestaña
          </a>
          {directDownloadHref ? (
            <a
              href={directDownloadHref}
              download={fileName}
              className="h-9 px-3 inline-flex items-center text-xs font-medium rounded bg-[#E87722] hover:bg-[#E87722]/90 text-white transition-colors"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Descargar
            </a>
          ) : onDownload ? (
            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="h-9 bg-[#E87722] hover:bg-[#E87722]/90 text-white"
            >
              {downloading ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generando…</>
              ) : (
                <><Download className="h-3.5 w-3.5 mr-1.5" /> Descargar</>
              )}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
