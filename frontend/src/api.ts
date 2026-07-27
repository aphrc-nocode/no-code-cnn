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
  annotation_type?: 'bbox' | 'point';
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
    throw { response: { data: { detail }, status: res.status } };
  }
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    const data = await res.json();
    return { data };
  }
  return { data: null };
};

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

export const silentRefreshToken = async (): Promise<string | null> => {
  const refreshToken = localStorage.getItem("maklens_refresh_token");
  const currentToken = localStorage.getItem("maklens_token");

  try {
    const refreshUrl = resolveUrl("auth/refresh");
    const res = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      throw new Error("Refresh failed");
    }

    const data = await res.json();
    if (data && data.access_token) {
      localStorage.setItem("maklens_token", data.access_token);
      if (data.refresh_token) {
        localStorage.setItem("maklens_refresh_token", data.refresh_token);
      }
      document.cookie = `maklens_token=${data.access_token}; path=/; max-age=86400; SameSite=Lax`;
      if (data.user) {
        localStorage.setItem("maklens_user", JSON.stringify(data.user));
      }
      return data.access_token;
    }
  } catch (err) {
    console.warn("Silent refresh failed:", err);
  }
  return null;
};

const customFetch = async (
  fullUrl: string,
  options: RequestInit
): Promise<any> => {
  const token = localStorage.getItem("maklens_token");
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(fullUrl, { ...options, headers });

  const isAuthRoute = fullUrl.includes("auth/login") || fullUrl.includes("auth/refresh");

  if (res.status === 401 && !isAuthRoute) {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: async (newToken: string) => {
            headers["Authorization"] = `Bearer ${newToken}`;
            try {
              const retryRes = await fetch(fullUrl, { ...options, headers });
              resolve(await handleResponse(retryRes));
            } catch (e) {
              reject(e);
            }
          },
          reject: (err: any) => reject(err),
        });
      });
    }

    isRefreshing = true;

    try {
      const newToken = await silentRefreshToken();
      if (newToken) {
        processQueue(null, newToken);
        isRefreshing = false;
        headers["Authorization"] = `Bearer ${newToken}`;
        const retryRes = await fetch(fullUrl, { ...options, headers });
        return handleResponse(retryRes);
      } else {
        const error = new Error("Session expired");
        processQueue(error, null);
        isRefreshing = false;
        window.dispatchEvent(new CustomEvent("auth:session-expired"));
      }
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      isRefreshing = false;
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
    }
  }

  return handleResponse(res);
};

const api = {
  get: async (url: string, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    return customFetch(fullUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(config?.headers || {}),
      },
    });
  },
  post: async (url: string, body?: any, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const isFormData = body instanceof FormData;
    const headers: Record<string, string> = {
      ...(config?.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    return customFetch(fullUrl, {
      method: "POST",
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  },
  put: async (url: string, body?: any, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    const isFormData = body instanceof FormData;
    const headers: Record<string, string> = {
      ...(config?.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    return customFetch(fullUrl, {
      method: "PUT",
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  },
  delete: async (url: string, config?: any) => {
    let fullUrl = resolveUrl(url);
    if (config?.params) {
      const q = new URLSearchParams(config.params as any).toString();
      fullUrl += `?${q}`;
    }
    return customFetch(fullUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(config?.headers || {}),
      },
    });
  }
};

export default api;
export { BASE_URL };
