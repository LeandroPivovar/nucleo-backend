export interface ImportContactRow {
  name: string;
  phone?: string;
  email?: string;
  group?: string;
  status?: string;
  tags?: string; // Separado por ponto e vírgula
  state?: string;
  city?: string;
  segmentations?: string; // Separado por ponto e vírgula
}

