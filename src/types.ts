export interface Story {
  id: string;
  title: string;
  content: string;
  imageUrl: string;
  audioUrl?: string;
  theme: string;
  createdAt: number;
  isFavorite?: boolean;
}
