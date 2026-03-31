// Response Interfaces

export interface AppResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    errors?: any;
}

export const successResponse = <T>(message: string, data?: T): AppResponse<T> => ({
    success: true,
    message,
    data,
});

export const errorResponse = (message: string, errors?: any): AppResponse => ({
    success: false,
    message,
    errors,
});

//  Pagination 

export const parsePagination = (query: Record<string, string | undefined>) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// Misc

export const generateOTP = (): string =>
    Math.floor(100000 + Math.random() * 900000).toString();

export const maskPhone = (phone: string): string => {
    if (phone.length < 6) return "****";
    return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
};

export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export const isValidObjectId = (id: any): boolean => {
    if (typeof id !== "string") return false;
    return /^[a-f\d]{24}$/i.test(id);
};
