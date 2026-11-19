import { create } from 'zustand';

/** 纯前端版：项目元数据只存在于内存 / .vlx 文件里，没有服务器。 */
export type ProjectVisibility = 'public' | 'private';

export interface CurrentProject {
  id: string;
  slug: string;
  ownerUsername: string;
  isPublic: boolean;
  visibility?: ProjectVisibility;
}

interface ProjectState {
  currentProject: CurrentProject | null;
  setCurrentProject: (project: CurrentProject) => void;
  clearCurrentProject: () => void;
  setVisibility: (next: boolean | ProjectVisibility) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  clearCurrentProject: () => set({ currentProject: null }),
  setVisibility: (next) =>
    set((s) => {
      if (!s.currentProject) return s;
      const isPublic = typeof next === 'boolean' ? next : next === 'public';
      const visibility: ProjectVisibility = isPublic ? 'public' : 'private';
      return { currentProject: { ...s.currentProject, isPublic, visibility } };
    }),
}));
