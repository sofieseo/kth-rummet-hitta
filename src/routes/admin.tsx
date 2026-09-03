import { AnalyticsTab } from "@/components/AnalyticsTab";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { validateSpaceForm } from "@/lib/adminSpaceSchema";
import { processImageToWebp } from "@/lib/processImage";
import { exportSpacesToExcel } from "@/lib/spacesExport";
import { type FilterOption, type Space } from "@/lib/spaces";
import { useFilterCategories } from "@/lib/useFilterCategories";
import { groupOptionsByKey, useFilterOptions } from "@/lib/useFilterOptions";
import { cn } from "@/lib/utils";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Download, Info, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DynamicCategoryField, Field, ImageDropzone, LinkSyntaxHelp, SelectByLokaltyp, SortableImageRow } from "@/components/admin/shared";
import { SortableSpaceRow } from "@/components/admin/SpaceListRow";
import { FiltersTab } from "@/components/admin/FiltersTab";
import { CardLayoutTab } from "@/components/admin/CardLayoutTab";
import { LandingMessageTab } from "@/components/admin/TextsTab";
import { OccupancySettingsTab } from "@/components/admin/OccupancyTab";
import { OpeningHoursTab } from "@/components/admin/OpeningHoursTab";
import { SpaceEditorDialog } from "@/components/admin/SpaceEditorDialog";
import { MAX_IMAGES, type BulkAction, BULK_ACTIONS, BULK_RICH_TEXT_ACTIONS, type FormState, emptyForm, spaceToForm, getFormValues, setFormValues } from "@/components/admin/adminForm";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — KTH Biblioteket" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [originalForm, setOriginalForm] = useState<FormState>(emptyForm);
  const [editTab, setEditTab] = useState<"basic" | "filter" | "text" | "media" | "advanced">("basic");
  const [imageDates, setImageDates] = useState<Record<string, string | null>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>("set_floor");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkAccess = async (session: { user: { id: string; email?: string | null } } | null) => {
      if (!session) {
        navigate({ to: "/login" });
        return;
      }
      const { data: isAdmin, error } = await supabase.rpc("has_role", {
        _user_id: session.user.id,
        _role: "admin",
      });
      if (!mounted) return;
      if (error || !isAdmin) {
        toast.error("Saknar admin-behörighet");
        await supabase.auth.signOut();
        navigate({ to: "/login" });
        return;
      }
      setUserEmail(session.user.email ?? null);
      setAuthChecked(true);
    };
    supabase.auth.getSession().then(({ data }) => {
      void checkAccess(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/login" });
      else void checkAccess(session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const fetchImageDates = useCallback(async (imageUrls: string[]) => {
    try {
      const { data: files, error } = await supabase.storage.from("space-images").list("");
      if (error || !files) return;
      const byName = new Map(files.map((f) => [f.name, f.created_at]));
      const next: Record<string, string | null> = {};
      for (const url of imageUrls) {
        const name = url.split("/").pop()?.split("?")[0] ?? "";
        next[url] = byName.get(name) ?? null;
      }
      setImageDates(next);
    } catch {
      // tyst fallbacks — visar bara inget datum
    }
  }, []);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ["spaces"],
    queryFn: async (): Promise<Space[]> => {
      const { data, error } = await supabase.from("spaces").select("*").order("sort_order").order("name");
      if (error) throw error;
      return data as unknown as Space[];
    },
  });

  const reorderSpaces = useMutation({
    mutationFn: async (ordered: Space[]) => {
      await Promise.all(
        ordered.map((s, i) =>
          supabase
            .from("spaces")
            .update({ sort_order: (i + 1) * 10 })
            .eq("id", s.id),
        ),
      );
    },
    onMutate: async (ordered: Space[]) => {
      await qc.cancelQueries({ queryKey: ["spaces"] });
      const previous = qc.getQueryData<Space[]>(["spaces"]);
      qc.setQueryData<Space[]>(["spaces"], ordered);
      return { previous };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(["spaces"], ctx.previous);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSpacesDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = spaces.findIndex((s) => s.id === active.id);
    const newIdx = spaces.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    reorderSpaces.mutate(arrayMove(spaces, oldIdx, newIdx));
  };

  const { data: filterOptions = [] } = useFilterOptions();
  const { data: categories = [] } = useFilterCategories();
  const byKey = groupOptionsByKey(filterOptions);

  // Read the two special categories from DB so their labels/icons/order
  // (edited from the Filters tab) drive the space editor's own pickers.
  const spaceKindCat = categories.find((c) => c.special_kind === "space_kind");
  const arbetssattCat = categories.find((c) => c.special_kind === "arbetssatt");
  const spaceKindOptions: FilterOption[] = (spaceKindCat ? (byKey[spaceKindCat.key] ?? []) : []).filter(
    (o) => !o.hidden && o.value_key,
  );
  const arbetssattOptions: FilterOption[] = (arbetssattCat ? (byKey[arbetssattCat.key] ?? []) : []).filter(
    (o) => !o.hidden && o.value_key,
  );

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const capNum = f.capacity.trim() ? parseInt(f.capacity, 10) : NaN;
      const compNum = f.computer_count.trim() ? parseInt(f.computer_count, 10) : NaN;
      const informalNum = f.informal_seat_count.trim() ? parseInt(f.informal_seat_count, 10) : NaN;
      const payload: any = {
        space_kind: f.space_kind,
        slug: f.slug.trim() ? f.slug.trim().toLowerCase() : null,
        name: f.name,
        name_en: f.name_en.trim() || null,
        description: f.description,
        description_en: f.description_en.trim() || null,
        description_inline: f.description_inline,
        floor: f.floor?.trim() ? f.floor.trim() : null,
        floor_en: f.floor_en?.trim() ? f.floor_en.trim() : null,
        located_in: f.located_in?.trim() ? f.located_in.trim() : null,
        located_in_en: f.located_in_en?.trim() ? f.located_in_en.trim() : null,
        capacity: Number.isFinite(capNum) ? capNum : null,
        computer_count: Number.isFinite(compNum) ? compNum : null,
        informal_seat_count: Number.isFinite(informalNum) ? informalNum : null,
        show_capacity_publicly: f.show_capacity_publicly,
        show_occupancy: f.show_occupancy,
        countmatters_sensor_id: f.countmatters_sensor_id.trim() || null,
        booking_room_number: f.booking_room_number.trim() ? Number.parseInt(f.booking_room_number, 10) || null : null,
        intent: f.intent,
        noise: f.noise,
        equipment: f.equipment,
        facilities: f.facilities,
        lokaltyp: f.lokaltyp,
        tags: f.tags,
        images: f.images,
        image_alts: f.image_alts,
        image_alts_en: f.image_alts_en,
        image_url: f.images[0] ?? null,
        map_url: f.map_url.trim() || null,
        map_url_en: f.map_url_en.trim() || null,
        booking_url: f.booking_url.trim() || null,
        booking_url_en: f.booking_url_en.trim() || null,
        group_booking_url: f.group_booking_url.trim() || null,
        group_booking_url_en: f.group_booking_url_en.trim() || null,
        group_booking_label: f.group_booking_label.trim() || null,
        group_booking_label_en: f.group_booking_label_en.trim() || null,
        book_now_url: f.book_now_url.trim() || null,
        book_now_url_en: f.book_now_url_en.trim() || null,
        notice: f.notice.trim() || null,
        notice_en: f.notice_en.trim() || null,
        info: f.info.trim() || null,
        info_en: f.info_en.trim() || null,
      };

      if (f.id) {
        const { error } = await supabase.from("spaces").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("spaces").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
      setOpen(false);
      setForm(emptyForm);
      toast.success("Sparat");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Restore a deleted space from the snapshot taken before deletion (undo).
  const restore = useMutation({
    mutationFn: async (row: Space) => {
      const { error } = await supabase.from("spaces").insert(row as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
      toast.success("Lokalen är återställd");
    },
    onError: (e: any) => toast.error(e.message ?? "Kunde inte återställa lokalen"),
  });

  const del = useMutation({
    mutationFn: async (space: Space) => {
      const { error } = await supabase.from("spaces").delete().eq("id", space.id);
      if (error) throw error;
      return space;
    },
    onSuccess: (space) => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
      toast.success(`"${space.name}" är borttagen`, {
        duration: 10000,
        action: { label: "Ångra", onClick: () => restore.mutate(space) },
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Kunde inte ta bort lokalen"),
  });

  const toggleHidden = useMutation({
    mutationFn: async ({ id, hidden }: { id: string; hidden: boolean; silent?: boolean }) => {
      const { error } = await supabase
        .from("spaces")
        .update({ hidden } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
      if (vars.silent) return;
      toast.success(vars.hidden ? "Lokalen är dold" : "Lokalen är synlig igen", {
        duration: 8000,
        action: {
          label: "Ångra",
          onClick: () => toggleHidden.mutate({ id: vars.id, hidden: !vars.hidden, silent: true }),
        },
      });
    },
    onError: (e: any) => toast.error(e.message),
  });


  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectAll = () => setSelectedIds(new Set(spaces.map((s) => s.id)));

  const [bulkCategory, setBulkCategory] = useState<string>("lokaltyp");

  // List UI state (persisted in localStorage) — search, filters, compact view.
  const [listQuery, setListQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("admin.spaces.query") ?? "";
  });
  const [listKind, setListKind] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return window.localStorage.getItem("admin.spaces.kind") ?? "all";
  });
  const [listVisibility, setListVisibility] = useState<"all" | "visible" | "hidden">(() => {
    if (typeof window === "undefined") return "all";
    const v = window.localStorage.getItem("admin.spaces.visibility");
    return v === "visible" || v === "hidden" ? v : "all";
  });
  const [listLokaltyp, setListLokaltyp] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return window.localStorage.getItem("admin.spaces.lokaltyp") ?? "all";
  });
  const [listCompact, setListCompact] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("admin.spaces.compact") === "1";
  });
  useEffect(() => {
    window.localStorage.setItem("admin.spaces.query", listQuery);
  }, [listQuery]);
  useEffect(() => {
    window.localStorage.setItem("admin.spaces.kind", listKind);
  }, [listKind]);
  useEffect(() => {
    window.localStorage.setItem("admin.spaces.visibility", listVisibility);
  }, [listVisibility]);
  useEffect(() => {
    window.localStorage.setItem("admin.spaces.lokaltyp", listLokaltyp);
  }, [listLokaltyp]);
  useEffect(() => {
    window.localStorage.setItem("admin.spaces.compact", listCompact ? "1" : "0");
  }, [listCompact]);

  const applyBulk = async () => {
    if (selectedIds.size === 0) return;
    const meta = BULK_ACTIONS.find((a) => a.value === bulkAction);
    if (!meta) return;
    const val = bulkValue.trim();
    if (meta.needsValue && !val) {
      toast.error("Ange ett värde");
      return;
    }
    if (!confirm(`Tillämpa "${meta.label}" på ${selectedIds.size} lokal(er)?`)) return;

    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const selectedSpaces = spaces.filter((s) => ids.includes(s.id));

      const simple: Record<string, any> | null = (() => {
        switch (bulkAction) {
          case "set_description":
            return { description: val };
          case "clear_description":
            return { description: "" };
          case "set_description_en":
            return { description_en: val };
          case "clear_description_en":
            return { description_en: null };
          case "set_floor":
            return { floor: val };
          case "set_floor_en":
            return { floor_en: val };
          case "set_notice":
            return { notice: val };
          case "clear_notice":
            return { notice: null };
          case "set_notice_en":
            return { notice_en: val };
          case "clear_notice_en":
            return { notice_en: null };
          case "set_info":
            return { info: val };
          case "clear_info":
            return { info: null };
          case "set_info_en":
            return { info_en: val };
          case "clear_info_en":
            return { info_en: null };
          case "show_occupancy_on":
            return { show_occupancy: true };
          case "show_occupancy_off":
            return { show_occupancy: false };
          default:
            return null;
        }
      })();

      if (simple) {
        const { error } = await supabase
          .from("spaces")
          .update(simple as any)
          .in("id", ids);
        if (error) throw error;
      } else if (bulkAction === "add_filter" || bulkAction === "remove_filter") {
        const cat = bulkCategory;
        if (cat === "vaningsplan") {
          throw new Error("Använd 'Sätt våningsplan' för plan");
        }
        // Map category key to spaces column (or tags JSON)
        const colMap: Record<string, string> = {
          intent: "intent",
          arbetssatt: "intent",
          noise: "noise",
          equipment: "equipment",
          facility: "facilities",
          lokaltyp: "lokaltyp",
        };
        const col = colMap[cat];
        await Promise.all(
          selectedSpaces.map((s) => {
            if (col) {
              const cur = Array.isArray((s as any)[col]) ? ((s as any)[col] as string[]) : [];
              const next =
                bulkAction === "add_filter" ? (cur.includes(val) ? cur : [...cur, val]) : cur.filter((x) => x !== val);
              return supabase
                .from("spaces")
                .update({ [col]: next } as any)
                .eq("id", s.id);
            } else {
              const tags =
                s.tags && typeof s.tags === "object" && !Array.isArray(s.tags)
                  ? { ...(s.tags as Record<string, string[]>) }
                  : {};
              const cur = Array.isArray(tags[cat]) ? tags[cat] : [];
              const next =
                bulkAction === "add_filter" ? (cur.includes(val) ? cur : [...cur, val]) : cur.filter((x) => x !== val);
              if (next.length === 0) delete tags[cat];
              else tags[cat] = next;
              return supabase
                .from("spaces")
                .update({ tags: tags as any })
                .eq("id", s.id);
            }
          }),
        );
      }

      toast.success(`Uppdaterade ${ids.length} lokal(er)`);
      setBulkValue("");
      clearSelection();
      qc.invalidateQueries({ queryKey: ["spaces"] });
    } catch (e: any) {
      toast.error(e.message ?? "Fel vid bulk-uppdatering");
    } finally {
      setBulkBusy(false);
    }
  };

  const [uploadBusy, setUploadBusy] = useState(false);

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast.error("Ingen bildfil hittades");
      return;
    }
    const remaining = MAX_IMAGES - form.images.length;
    if (remaining <= 0) {
      toast.error(`Max ${MAX_IMAGES} bilder.`);
      return;
    }
    const batch = files.slice(0, remaining);
    if (files.length > remaining) {
      toast.warning(`Endast ${remaining} av ${files.length} bilder laddades upp (max ${MAX_IMAGES}).`);
    }

    setUploadBusy(true);
    try {
      for (const file of batch) {
        try {
          const processed = await processImageToWebp(file);
          const path = `${crypto.randomUUID()}.webp`;
          const { error } = await supabase.storage
            .from("space-images")
            .upload(path, processed.file, { contentType: "image/webp" });
          if (error) {
            toast.error(`${file.name}: ${error.message}`);
            continue;
          }
          const { data } = supabase.storage.from("space-images").getPublicUrl(path);
          const nowIso = new Date().toISOString();
          setForm((f) => ({
            ...f,
            images: [...f.images, data.publicUrl],
            image_alts: [...f.image_alts, ""],
            image_alts_en: [...f.image_alts_en, ""],
          }));
          setImageDates((prev) => ({ ...prev, [data.publicUrl]: nowIso }));
        } catch (e: any) {
          toast.error(`${file.name}: ${e?.message ?? "kunde inte bearbetas"}`);
        }
      }
      toast.success(batch.length === 1 ? "Bild uppladdad" : `${batch.length} bilder uppladdade`);
    } finally {
      setUploadBusy(false);
    }
  };

  const reorderImagesByIndex = (oldIdx: number, newIdx: number) => {
    setForm((f) => {
      if (oldIdx < 0 || newIdx < 0 || oldIdx >= f.images.length || newIdx >= f.images.length) return f;
      const alts = [...f.image_alts];
      const altsEn = [...f.image_alts_en];
      while (alts.length < f.images.length) alts.push("");
      while (altsEn.length < f.images.length) altsEn.push("");
      return {
        ...f,
        images: arrayMove(f.images, oldIdx, newIdx),
        image_alts: arrayMove(alts, oldIdx, newIdx),
        image_alts_en: arrayMove(altsEn, oldIdx, newIdx),
      };
    });
  };

  const handleImagesDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = form.images.map((u, i) => `${i}::${u}`);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    reorderImagesByIndex(oldIdx, newIdx);
  };

  const removeImage = (i: number) => {
    setForm((f) => ({
      ...f,
      images: f.images.filter((_, idx) => idx !== i),
      image_alts: f.image_alts.filter((_, idx) => idx !== i),
      image_alts_en: f.image_alts_en.filter((_, idx) => idx !== i),
    }));
  };

  const setAlt = (i: number, value: string) => {
    setForm((f) => {
      const alts = [...f.image_alts];
      while (alts.length < f.images.length) alts.push("");
      alts[i] = value;
      return { ...f, image_alts: alts };
    });
  };

  const setAltEn = (i: number, value: string) => {
    setForm((f) => {
      const alts = [...f.image_alts_en];
      while (alts.length < f.images.length) alts.push("");
      alts[i] = value;
      return { ...f, image_alts_en: alts };
    });
  };

  const openEdit = (s: Space) => {
    const f = spaceToForm(s);
    setForm(f);
    setOriginalForm(f);
    setImageDates({});
    setEditTab("basic");
    setOpen(true);
    fetchImageDates(f.images);
  };
  const openNew = () => {
    setForm(emptyForm);
    setOriginalForm(emptyForm);
    setImageDates({});
    setEditTab("basic");
    setOpen(true);
  };
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(originalForm), [form, originalForm]);

  // Client-side validation of the space form (numbers, links, required fields).
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const handleSave = () => {
    const errors = validateSpaceForm(form as unknown as Record<string, unknown>);
    setFormErrors(errors);
    if (errors.length > 0) {
      toast.error("Kontrollera fälten innan du sparar.");
      return;
    }
    save.mutate(form);
  };
  // Guard against losing edits when the dialog is dismissed by mistake.
  const handleDialogOpenChange = (next: boolean) => {
    if (!next && isDirty && !save.isPending) {
      const discard = window.confirm("Du har ändringar som inte är sparade. Vill du stänga ändå?");
      if (!discard) return;
    }
    if (!next) setFormErrors([]);
    setOpen(next);
  };



  useEffect(() => {
    if (open && form.images.length > 0) {
      fetchImageDates(form.images);
    }
  }, [open, form.images.length, fetchImageDates]);

  // Filtered spaces for the admin list — search + kind + visibility + lokaltyp.
  const listFiltersActive =
    listQuery.trim() !== "" || listKind !== "all" || listVisibility !== "all" || listLokaltyp !== "all";
  const filteredSpaces = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return spaces.filter((s) => {
      if (listKind !== "all" && (s.space_kind ?? "study") !== listKind) return false;
      if (listVisibility === "visible" && s.hidden) return false;
      if (listVisibility === "hidden" && !s.hidden) return false;
      if (listLokaltyp !== "all" && !(s.lokaltyp ?? []).includes(listLokaltyp)) return false;
      if (q) {
        const hay = [s.name, s.name_en ?? "", s.slug ?? "", s.floor ?? "", s.located_in ?? ""].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [spaces, listQuery, listKind, listVisibility, listLokaltyp]);

  if (!authChecked) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground">Laddar...</div>;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between">
          <h1 className="text-base font-semibold leading-tight text-[var(--kth-navy)]">Admin — Studieplatser</h1>
          <div className="flex items-center gap-3">
            {userEmail && <span className="hidden sm:inline text-xs text-muted-foreground">{userEmail}</span>}
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              Logga ut
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Till studentvy
            </Link>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="max-w-6xl mx-auto px-4 sm:px-6 py-6 focus-visible:outline-none">
        <Tabs defaultValue="spaces" className="w-full">
          <TabsList className="mb-6 flex w-full h-auto flex-wrap justify-start gap-1 p-1 sm:grid sm:grid-cols-7">
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="spaces">Lokaler</TabsTrigger>
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="filters">Filteralternativ</TabsTrigger>
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="landing">Texter</TabsTrigger>

            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="layout">Kortlayout</TabsTrigger>
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="occupancy">Beläggning</TabsTrigger>
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="hours">Öppettider</TabsTrigger>
            <TabsTrigger className="flex-1 min-w-[calc(50%-0.25rem)] whitespace-normal px-2 py-2 text-xs leading-tight sm:min-w-0 sm:text-sm" value="analytics">Statistik</TabsTrigger>
          </TabsList>

          <TabsContent value="spaces" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                Alla lokaler/ytor{" "}
                <span className="text-muted-foreground font-normal">
                  ({listFiltersActive ? `${filteredSpaces.length} av ${spaces.length}` : spaces.length})
                </span>
              </h2>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const list = listFiltersActive ? filteredSpaces : spaces;
                  if (list.length === 0) {
                    toast.error("Inga lokaler att exportera.");
                    return;
                  }
                  exportSpacesToExcel(list, categories, byKey);
                  toast.success(`Exporterade ${list.length} lokaler till Excel.`);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                title="Exporterar all information (utom bilder) till ett Excel-ark"
              >
                <Download className="h-4 w-4" /> Exportera till Excel
              </button>
              <Dialog open={open} onOpenChange={handleDialogOpenChange}>

                <DialogTrigger asChild>
                  <button
                    onClick={openNew}
                    className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" /> Ny lokal
                  </button>
                </DialogTrigger>
                <SpaceEditorDialog
                  form={form}
                  setForm={setForm}
                  spaces={spaces}
                  categories={categories}
                  byKey={byKey}
                  spaceKindCat={spaceKindCat}
                  spaceKindOptions={spaceKindOptions}
                  arbetssattCat={arbetssattCat}
                  arbetssattOptions={arbetssattOptions}
                  editTab={editTab}
                  setEditTab={setEditTab}
                  isDirty={isDirty}
                  saving={save.isPending}
                  formErrors={formErrors}
                  handleSave={handleSave}
                  handleDialogOpenChange={handleDialogOpenChange}
                  sensors={sensors}
                  handleImagesDragEnd={handleImagesDragEnd}
                  imageDates={imageDates}
                  setAlt={setAlt}
                  setAltEn={setAltEn}
                  removeImage={removeImage}
                  uploadBusy={uploadBusy}
                  handleUploadFiles={handleUploadFiles}
                />
              </Dialog>
              </div>
            </div>


            {selectedIds.size > 0 && (
              <div className="bg-accent/40 border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {selectedIds.size} markerad{selectedIds.size === 1 ? "" : "e"}
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Avmarkera
                </button>
                <div className="flex-1" />
                <select
                  value={bulkAction}
                  onChange={(e) => {
                    setBulkAction(e.target.value as BulkAction);
                    setBulkValue("");
                  }}
                  aria-label="Bulk-åtgärd"
                  className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                >
                  {BULK_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {bulkAction === "add_filter" || bulkAction === "remove_filter" ? (
                  <>
                    <select
                      value={bulkCategory}
                      onChange={(e) => {
                        setBulkCategory(e.target.value);
                        setBulkValue("");
                      }}
                      aria-label="Filterkategori"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                    >
                      {categories
                        .filter((c) => c.key !== "vaningsplan")
                        .map((c) => (
                          <option key={c.id} value={c.key}>
                            {c.title}
                          </option>
                        ))}
                    </select>
                    <select
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      aria-label="Värde"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm min-w-[10rem]"
                    >
                      <option value="">— välj värde —</option>
                      {(byKey[bulkCategory] ?? []).map((o) => (
                        <option key={o.id} value={o.label}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  BULK_ACTIONS.find((a) => a.value === bulkAction)?.needsValue &&
                  (() => {
                    const isRichText = BULK_RICH_TEXT_ACTIONS.includes(bulkAction);
                    if (isRichText) {
                      return (
                        <textarea
                          value={bulkValue}
                          onChange={(e) => setBulkValue(e.target.value)}
                          placeholder={BULK_ACTIONS.find((a) => a.value === bulkAction)?.placeholder ?? ""}
                          aria-label={BULK_ACTIONS.find((a) => a.value === bulkAction)?.placeholder ?? "Värde"}
                          rows={5}
                          className="basis-full min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed resize-y min-h-[7rem]"
                        />
                      );
                    }
                    return (
                      <input
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        placeholder={BULK_ACTIONS.find((a) => a.value === bulkAction)?.placeholder ?? ""}
                        aria-label={BULK_ACTIONS.find((a) => a.value === bulkAction)?.placeholder ?? "Värde"}
                        className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm min-w-[12rem]"
                      />
                    );
                  })()
                )}
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={applyBulk}
                  className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {bulkBusy ? "Uppdaterar..." : "Tillämpa"}
                </button>
                {(bulkAction === "set_notice" ||
                  bulkAction === "set_notice_en" ||
                  bulkAction === "set_info" ||
                  bulkAction === "set_info_en" ||
                  bulkAction === "set_description" ||
                  bulkAction === "set_description_en") && (
                  <p className="basis-full text-xs text-muted-foreground leading-relaxed">
                    <strong>Länkar:</strong> länka till en webbsida med{" "}
                    <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">
                      &lt;a href="https://exempel.se"&gt;Länktext&lt;/a&gt;
                    </code>
                    . Länka till ett annat lokalkort med{" "}
                    <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">[[slug|Länktext]]</code> (eller bara{" "}
                    <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">[[slug]]</code> för att använda
                    lokalens namn).
                  </p>
                )}
              </div>
            )}

            <SelectByLokaltyp
              spaces={spaces}
              options={byKey["lokaltyp"] ?? []}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
            />

            <div className="space-y-2">
              {isLoading ? (
                <div className="bg-card rounded-2xl border border-border p-8 text-center text-muted-foreground">
                  Laddar...
                </div>
              ) : spaces.length === 0 ? (
                <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground text-sm">
                  Inga lokaler ännu. Klicka på <span className="font-medium text-foreground">Ny lokal</span> för att
                  komma igång.
                </div>
              ) : (
                <>
                  {/* List toolbar: search, filters, compact toggle */}
                  <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[12rem]">
                      <Search
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={listQuery}
                        onChange={(e) => setListQuery(e.target.value)}
                        placeholder="Sök på namn, slug, plan eller lokal…"
                        aria-label="Sök i lokallistan"
                        className="w-full rounded-lg border border-border bg-background pl-8 pr-8 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      {listQuery && (
                        <button
                          type="button"
                          onClick={() => setListQuery("")}
                          aria-label="Rensa sökning"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="sr-only">Typ</span>
                      <select
                        value={listKind}
                        onChange={(e) => setListKind(e.target.value)}
                        aria-label="Filtrera på typ"
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="all">Alla typer</option>
                        {spaceKindOptions.map((o) => (
                          <option key={o.id} value={o.value_key ?? ""}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="sr-only">Lokaltyp</span>
                      <select
                        value={listLokaltyp}
                        onChange={(e) => setListLokaltyp(e.target.value)}
                        aria-label="Filtrera på lokaltyp"
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="all">Alla lokaltyper</option>
                        {(byKey["lokaltyp"] ?? [])
                          .filter((o) => !o.hidden)
                          .map((o) => (
                            <option key={o.id} value={o.label}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="sr-only">Synlighet</span>
                      <select
                        value={listVisibility}
                        onChange={(e) => setListVisibility(e.target.value as "all" | "visible" | "hidden")}
                        aria-label="Filtrera på synlighet"
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="all">Alla</option>
                        <option value="visible">Endast synliga</option>
                        <option value="hidden">Endast dolda</option>
                      </select>
                    </label>
                    <label className="text-xs flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg cursor-pointer select-none hover:bg-accent/60">
                      <Switch checked={listCompact} onCheckedChange={setListCompact} aria-label="Kompakt vy" />
                      <span className="text-foreground">Kompakt vy</span>
                    </label>
                    {listFiltersActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setListQuery("");
                          setListKind("all");
                          setListVisibility("all");
                          setListLokaltyp("all");
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        Rensa filter
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      aria-label="Markera alla synliga"
                      checked={filteredSpaces.length > 0 && filteredSpaces.every((s) => selectedIds.has(s.id))}
                      ref={(el) => {
                        if (el) {
                          const sel = filteredSpaces.filter((s) => selectedIds.has(s.id)).length;
                          el.indeterminate = sel > 0 && sel < filteredSpaces.length;
                        }
                      }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            filteredSpaces.forEach((s) => next.add(s.id));
                            return next;
                          });
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            filteredSpaces.forEach((s) => next.delete(s.id));
                            return next;
                          });
                        }
                      }}
                    />
                    <span>
                      {listFiltersActive
                        ? `Markera alla ${filteredSpaces.length} träffar`
                        : `Markera alla · ${spaces.length} lokaler/ytor`}
                    </span>
                  </div>

                  {listFiltersActive && (
                    <div className="text-xs text-muted-foreground px-4 py-1.5 rounded-lg bg-muted/40 border border-dashed border-border">
                      Filter är aktivt — omordning är inaktiverad. Rensa filter för att sortera om listan.
                    </div>
                  )}

                  {filteredSpaces.length === 0 ? (
                    <div className="bg-card rounded-2xl border border-border p-8 text-center text-muted-foreground text-sm">
                      Inga lokaler matchar dina filter.
                    </div>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSpacesDragEnd}>
                      <SortableContext items={filteredSpaces.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                        <ul className={cn("list-none", listCompact ? "space-y-1" : "space-y-2")}>
                          {filteredSpaces.map((s) => (
                            <SortableSpaceRow
                              key={s.id}
                              space={s}
                              selected={selectedIds.has(s.id)}
                              compact={listCompact}
                              dragDisabled={listFiltersActive}
                              onToggleSelected={() => toggleSelected(s.id)}
                              onEdit={() => openEdit(s)}
                              onToggleHidden={() => toggleHidden.mutate({ id: s.id, hidden: !s.hidden })}
                              onDelete={() => {
                                if (!s.hidden) {
                                  toast.error("Dölj lokalen först innan du kan radera den.");
                                  return;
                                }
                                // No confirm dialog: the toast offers an "Ångra" action instead.
                                del.mutate(s);
                              }}

                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="filters">
            <FiltersTab categories={categories} byKey={byKey} />
          </TabsContent>

          <TabsContent value="layout">
            <CardLayoutTab />
          </TabsContent>


          <TabsContent value="landing">
            <LandingMessageTab />
          </TabsContent>

          <TabsContent value="occupancy">
            <OccupancySettingsTab />
          </TabsContent>

          <TabsContent value="hours">
            <OpeningHoursTab />
          </TabsContent>



          <TabsContent value="analytics">
            <AnalyticsTab spaces={spaces} categories={categories} filterOptions={filterOptions} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
