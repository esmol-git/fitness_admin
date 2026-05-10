Put your contract PDF template here as `contract-template.pdf`.
You can also use HTML template `contract-template.html`.

Requirements:
- The PDF should contain AcroForm fields.
- Field names can be Russian or English (for example: `ФИО`, `Имя`, `lastName`, `phone`).
- You can inspect actual field names via `GET /api/contracts/template-fields`.

If your template is in another path, set `CONTRACT_TEMPLATE_PATH` in backend `.env`.
For HTML use `CONTRACT_TEMPLATE_HTML_PATH`.
