import { useId } from "react";
import { sports } from "../shared/sports";
export function SportInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (sport: string) => void;
}) {
  const id = useId();
  return (
    <label className="field">
      Sport
      <input
        required
        maxLength={80}
        list={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Choose or type any sport"
      />
      <datalist id={id}>
        {sports.map((sport) => (
          <option key={sport} value={sport} />
        ))}
      </datalist>
    </label>
  );
}
