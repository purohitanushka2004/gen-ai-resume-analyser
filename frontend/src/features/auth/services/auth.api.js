import axios from "axios"


const api = axios.create({
    baseURL: "http://localhost:3000",
    withCredentials: true
})

export async function register({ username, email, password }) {

    if (!username?.trim()) {
        throw new Error("Username is required");
    }

    if (!email?.trim()) {
        throw new Error("Email is required");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        throw new Error("Invalid email format");
    }

    if (!password || password.length < 6) {
        throw new Error("Password must be at least 6 characters");
    }

    try {
        const response = await api.post("/api/auth/register", {
            username,
            email,
            password
        });

        return response.data;

    } catch (err) {
        throw err.response?.data || err;
    }
}

export async function login({ email, password }) {

    if (!email?.trim()) {
        throw new Error("Email is required");
    }

    if (!password?.trim()) {
        throw new Error("Password is required");
    }

    try {
        const response = await api.post("/api/auth/login", {
            email,
            password
        });

        return response.data;

    } catch (err) {
        throw err.response?.data || err;
    }
}

export async function logout() {
    try {

        const response = await api.get("/api/auth/logout")

        return response.data

    } catch (err) {

    }
}

export async function getMe() {

    try {

        const response = await api.get("/api/auth/get-me")

        return response.data

    } catch (err) {
        console.log(err)
    }

}