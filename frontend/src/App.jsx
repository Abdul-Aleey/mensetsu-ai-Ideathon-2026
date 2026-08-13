import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import HowItWorks from "./pages/HowItWorks.jsx";
import Setup from "./pages/Setup.jsx";
import Interview from "./pages/Interview.jsx";
import Complete from "./pages/Complete.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/interview/:sessionId" element={<Interview />} />
        <Route path="/complete/:sessionId" element={<Complete />} />
      </Routes>
    </BrowserRouter>
  );
}
