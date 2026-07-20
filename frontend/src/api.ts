const BASE_URL = "";

export interface AnnData {
  id?: number;
  shape_type: 'bbox' | 'polygon' | 'point';
  class_id: number;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
  points: [number, number][];
}

export interface ImageItem {
  id: number;
  filename: string;
  annotated: boolean;
}

export interface Project {
  id: number;
  name: string;
  task_type: 'image_classification' | 'object_detection' | 'image_segmentation';
  classes: string[];
}

export interface ExternalModel {
  id: string;
  name: string;
}

const resolveUrl = (url: string) => {
  if (url.startsWith("http")) return url;
  
  // Strip leading slash
  const cleanUrl = url.startsWith("/") ? url.slice(1) : url;
  
  // If it's already versioned, return directly
  if (cleanUrl.startsWith("api/v1/")) {
    return `${BASE_URL}/${cleanUrl}`;
  }
  
  // If it starts with api/projects, strip 'api/'
  let targetUrl = cleanUrl;
  if (targetUrl.startsWith("api/projects")) {
    targetUrl = targetUrl.replace("api/projects", "projects");
  }
  
  return `${BASE_URL}/api/v1/${targetUrl}`;
};

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const errData = await res.json();
      detail = errData.detail || detail;
    } catch (_) {}
    throw { response: { data: { detail } } };
  }
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    const data = await res.json();
    return { data };
  }
  return { data: null };
};

const api = {
  get: async (url: string, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const token = localStorage.getItem("maklens_token");
    const res = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(config?.headers || {}),
      },
    });
    return handleResponse(res);
  },
  post: async (url: string, body?: any, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const isFormData = body instanceof FormData;
    const token = localStorage.getItem("maklens_token");
    const headers: Record<string, string> = {
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(config?.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(fullUrl, {
      method: "POST",
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
    return handleResponse(res);
  },
  put: async (url: string, body?: any, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const isFormData = body instanceof FormData;
    const token = localStorage.getItem("maklens_token");
    const headers: Record<string, string> = {
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(config?.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(fullUrl, {
      method: "PUT",
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
    return handleResponse(res);
  },
  delete: async (url: string, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const token = localStorage.getItem("maklens_token");
    const res = await fetch(fullUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(config?.headers || {}),
      },
    });
    return handleResponse(res);
  }
};

export default api;
export { BASE_URL };
