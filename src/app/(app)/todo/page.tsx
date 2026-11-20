import { Suspense } from "react";
import { TodoApp } from "@/components/todo/TodoApp";

export const metadata = { title: "To-Do · Master Calendar" };

export default function TodoPage() {
  return (
    <Suspense>
      <TodoApp />
    </Suspense>
  );
}
