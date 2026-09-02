export { Input } from "@/components/ui/input";
export type { InputProps } from "@/components/ui/input";
export default function InputComponent(props: any) {
  const { Input } = require("@/components/ui/input");
  return <Input {...props} />;
}
